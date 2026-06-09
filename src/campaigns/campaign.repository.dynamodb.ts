import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Campaign, CampaignStatus } from './campaign.types';
import { CampaignRepository } from './campaign.repository';
import { AppError } from '../errors/app-error';

const PUBLISHER_INDEX = 'publisherId-index';

export class DynamoDBCampaignRepository implements CampaignRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName?: string) {
    this.tableName = tableName ?? process.env.TABLE_NAME ?? 'campaigns';
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'il-central-1' }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async create(campaign: Campaign): Promise<Campaign> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: campaign }));
    return campaign;
  }

  async findById(id: string): Promise<Campaign | undefined> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { id } }));
    return res.Item as Campaign | undefined;
  }

  async listByPublisher(opts: { publisherId: string; limit: number; offset: number }): Promise<{ data: Campaign[]; total: number }> {
    const { publisherId, limit, offset } = opts;
    const needed = offset + limit;
    const collected: Campaign[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: PUBLISHER_INDEX,
        KeyConditionExpression: 'publisherId = :pid',
        ExpressionAttributeValues: { ':pid': publisherId },
        ScanIndexForward: false,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }));
      collected.push(...((page.Items as Campaign[] | undefined) ?? []));
      lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey && collected.length < needed);

    const data = collected.slice(offset, offset + limit);

    // Count query for total
    let total = 0;
    let countKey: Record<string, unknown> | undefined;
    do {
      const countRes = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: PUBLISHER_INDEX,
        KeyConditionExpression: 'publisherId = :pid',
        ExpressionAttributeValues: { ':pid': publisherId },
        Select: 'COUNT',
        ...(countKey ? { ExclusiveStartKey: countKey } : {}),
      }));
      total += (countRes.Count ?? 0);
      countKey = countRes.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (countKey);

    return { data, total };
  }

  async updateStatus(id: string, status: CampaignStatus): Promise<Campaign | undefined> {
    try {
      const res = await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: 'SET #status = :status, version = version + :inc',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':inc': 1 },
        ReturnValues: 'ALL_NEW',
      }));
      return res.Attributes as Campaign | undefined;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return undefined;
      throw err;
    }
  }

  async updateStatusConditional(id: string, status: CampaignStatus, version: number): Promise<Campaign | undefined> {
    try {
      const res = await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: 'SET #status = :status, version = version + :inc',
        ConditionExpression: 'attribute_exists(id) AND version = :version',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':inc': 1, ':version': version },
        ReturnValues: 'ALL_NEW',
      }));
      return res.Attributes as Campaign | undefined;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        // Disambiguate: stale version (409) vs missing item (404/undefined)
        const existing = await this.findById(id);
        if (existing) throw AppError.versionConflict();
        return undefined;
      }
      throw err;
    }
  }

  async deleteById(id: string): Promise<boolean> {
    const res = await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { id },
      ReturnValues: 'ALL_OLD',
    }));
    return res.Attributes !== undefined;
  }
}
