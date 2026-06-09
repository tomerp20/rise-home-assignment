/**
 * Synchronous DynamoDB worker.
 *
 * The existing CampaignService and HTTP routes are fully synchronous and must
 * not be modified, so the DynamoDB repository needs a *blocking* API over the
 * inherently async AWS SDK. Pumping the event loop in-process (e.g. deasync)
 * deadlocks in Lambda when the SDK streams a response body. Instead, each
 * repository call spawns this script as a short-lived child process via
 * execFileSync: the child runs a normal async event loop (where response-body
 * streaming works correctly), prints a single JSON envelope to stdout, and the
 * parent blocks on it. This is pure JS — no native bindings, no event-loop
 * reentrancy — so it behaves identically locally and in Lambda.
 *
 * Protocol:
 *   argv[2] = JSON request: { command: string, input: object }
 *   stdout  = JSON envelope: { ok: true, data } | { ok: false, name, message }
 */
import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

type CommandName =
  | 'Put'
  | 'Get'
  | 'Query'
  | 'Update'
  | 'Delete';

interface WorkerRequest {
  command: CommandName;
  input: Record<string, unknown>;
}

function buildCommand(req: WorkerRequest) {
  const input = req.input as never;
  switch (req.command) {
    case 'Put':
      return new PutCommand(input);
    case 'Get':
      return new GetCommand(input);
    case 'Query':
      return new QueryCommand(input);
    case 'Update':
      return new UpdateCommand(input);
    case 'Delete':
      return new DeleteCommand(input);
    default:
      throw new Error(`ddb-exec: unknown command '${req.command}'`);
  }
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) throw new Error('ddb-exec: missing request argument');

  const req = JSON.parse(raw) as WorkerRequest;

  const clientConfig: DynamoDBClientConfig = {};
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
    marshallOptions: { removeUndefinedValues: true },
  });

  // The command type is a union; doc.send is overloaded per-command, so cast to
  // the document client's send signature via a permissive parameter type.
  const send = doc.send.bind(doc) as (cmd: unknown) => Promise<unknown>;
  const result = (await send(buildCommand(req))) as Record<string, unknown>;

  // Strip the SDK metadata; the repository only needs the data attributes.
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    if (k !== '$metadata') data[k] = v;
  }
  process.stdout.write(JSON.stringify({ ok: true, data }));
}

main().catch((err: unknown) => {
  const e = err as { name?: string; message?: string };
  process.stdout.write(
    JSON.stringify({
      ok: false,
      name: e?.name ?? 'Error',
      message: e?.message ?? String(err),
    }),
  );
  // Exit 0 — failures are communicated via the JSON envelope, not the exit code,
  // so execFileSync does not throw before we can read structured error info.
  process.exit(0);
});
