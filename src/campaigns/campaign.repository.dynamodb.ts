import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { Campaign, CampaignStatus } from './campaign.types';
import { CampaignRepository } from './campaign.repository';
import { AppError } from '../errors/app-error';

const PUBLISHER_INDEX = 'publisherId-index';

/** Marker the worker uses to report a DynamoDB ConditionalCheckFailedException. */
const CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailedException';

interface WorkerOk {
  ok: true;
  data: Record<string, unknown>;
}
interface WorkerErr {
  ok: false;
  name: string;
  message: string;
}

/**
 * Resolves the self-contained ddb-exec worker bundle (built by
 * `npm run build:worker` via esbuild — the AWS SDK is inlined, so it runs as a
 * standalone script with no node_modules at runtime).
 *
 * The bundle ships at src/campaigns/ddb-exec.bundle.js and is included in the
 * Lambda package (see serverless.yml package.patterns), landing at
 * /var/task/src/campaigns/ddb-exec.bundle.js. DDB_WORKER_PATH overrides lookup.
 */
const WORKER_FILENAME = 'ddb-exec.bundle.js';

function resolveWorkerPath(): string {
  if (process.env.DDB_WORKER_PATH) return process.env.DDB_WORKER_PATH;

  const candidates = [
    // In Lambda the worker is packaged at its source-relative path.
    path.join(
      process.env.LAMBDA_TASK_ROOT ?? '',
      'src',
      'campaigns',
      WORKER_FILENAME,
    ),
    // Local tsc build: dist/campaigns/* — hop back to the source tree.
    path.join(__dirname, '..', '..', 'src', 'campaigns', WORKER_FILENAME),
    // Running directly from the source tree (tsx/ts-node).
    path.join(__dirname, WORKER_FILENAME),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  // Fall back to the source-relative path; execFileSync surfaces a clear error
  // if it is genuinely missing.
  return candidates[candidates.length - 1];
}

type CommandName = 'Put' | 'Get' | 'Query' | 'Update' | 'Delete';

/**
 * Runs a single DynamoDB command synchronously by delegating to the ddb-exec
 * child process (see ddb-exec.ts for the rationale). Returns the data envelope,
 * or throws: ConditionalCheckFailedException is re-thrown as a sentinel the
 * callers below translate into 404/409 semantics.
 */
function execCommand(
  command: CommandName,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const workerPath = resolveWorkerPath();
  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      [workerPath, JSON.stringify({ command, input })],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10_000 },
    );
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(
      `ddb-exec worker failed: ${e.stderr || e.message || String(err)}`,
    );
  }

  let parsed: WorkerOk | WorkerErr;
  try {
    parsed = JSON.parse(stdout) as WorkerOk | WorkerErr;
  } catch {
    throw new Error(`ddb-exec worker returned non-JSON output: ${stdout}`);
  }

  if (parsed.ok) return parsed.data;

  if (parsed.name === CONDITIONAL_CHECK_FAILED) {
    const e = new Error(parsed.message);
    e.name = CONDITIONAL_CHECK_FAILED;
    throw e;
  }
  const e = new Error(parsed.message);
  e.name = parsed.name;
  throw e;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return err instanceof Error && err.name === CONDITIONAL_CHECK_FAILED;
}

/**
 * DynamoDB-backed CampaignRepository.
 *
 * Table layout:
 *   PK: id (S)
 *   GSI publisherId-index: publisherId (HASH) + createdAt (RANGE)
 *
 * The CampaignRepository interface is synchronous; each method performs its
 * DynamoDB work via execCommand (a blocking child process), so callers see the
 * same blocking semantics as the SQLite implementation.
 */
export class DynamoDBCampaignRepository implements CampaignRepository {
  private readonly tableName: string;

  constructor(tableName?: string) {
    this.tableName = tableName ?? process.env.TABLE_NAME ?? 'campaigns';
  }

  create(campaign: Campaign): Campaign {
    execCommand('Put', { TableName: this.tableName, Item: campaign });
    return campaign;
  }

  findById(id: string): Campaign | undefined {
    const res = execCommand('Get', { TableName: this.tableName, Key: { id } });
    return res.Item as Campaign | undefined;
  }

  listByPublisher(opts: {
    publisherId: string;
    limit: number;
    offset: number;
  }): { data: Campaign[]; total: number } {
    const { publisherId, limit, offset } = opts;

    // DynamoDB has no native OFFSET. Page through the GSI (newest first via the
    // createdAt range key, ScanIndexForward=false) until we've collected at
    // least offset+limit items, then slice the window we want.
    const needed = offset + limit;
    const collected: Campaign[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const page = execCommand('Query', {
        TableName: this.tableName,
        IndexName: PUBLISHER_INDEX,
        KeyConditionExpression: 'publisherId = :pid',
        ExpressionAttributeValues: { ':pid': publisherId },
        ScanIndexForward: false,
        ExclusiveStartKey: lastKey,
      });
      collected.push(...((page.Items as Campaign[] | undefined) ?? []));
      lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey && collected.length < needed);

    const data = collected.slice(offset, offset + limit);

    // Total via COUNT queries on the same index (no filter).
    let total = 0;
    let countKey: Record<string, unknown> | undefined;
    do {
      const countRes = execCommand('Query', {
        TableName: this.tableName,
        IndexName: PUBLISHER_INDEX,
        KeyConditionExpression: 'publisherId = :pid',
        ExpressionAttributeValues: { ':pid': publisherId },
        Select: 'COUNT',
        ExclusiveStartKey: countKey,
      });
      total += (countRes.Count as number | undefined) ?? 0;
      countKey = countRes.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (countKey);

    return { data, total };
  }

  updateStatus(id: string, status: CampaignStatus): Campaign | undefined {
    try {
      const res = execCommand('Update', {
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: 'SET #status = :status, version = version + :inc',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':inc': 1 },
        ReturnValues: 'ALL_NEW',
      });
      return res.Attributes as Campaign | undefined;
    } catch (err) {
      // Item does not exist → caller maps undefined to 404.
      if (isConditionalCheckFailed(err)) return undefined;
      throw err;
    }
  }

  updateStatusConditional(
    id: string,
    status: CampaignStatus,
    version: number,
  ): Campaign | undefined {
    try {
      const res = execCommand('Update', {
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: 'SET #status = :status, version = version + :inc',
        ConditionExpression: 'attribute_exists(id) AND version = :version',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':inc': 1,
          ':version': version,
        },
        ReturnValues: 'ALL_NEW',
      });
      return res.Attributes as Campaign | undefined;
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Stale version OR missing item — disambiguate with a read:
        // present → 409 version conflict; absent → 404 (undefined).
        const existing = this.findById(id);
        if (existing) throw AppError.versionConflict();
        return undefined;
      }
      throw err;
    }
  }

  deleteById(id: string): boolean {
    const res = execCommand('Delete', {
      TableName: this.tableName,
      Key: { id },
      ReturnValues: 'ALL_OLD',
    });
    return res.Attributes !== undefined;
  }
}
