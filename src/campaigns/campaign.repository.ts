import Database from 'better-sqlite3';
import { Campaign, CampaignStatus } from './campaign.types';

export interface CampaignRepository {
  create(campaign: Campaign): Campaign;
  findById(id: string): Campaign | undefined;
  listByPublisher(opts: {
    publisherId: string;
    limit: number;
    offset: number;
  }): { data: Campaign[]; total: number };
  updateStatus(id: string, status: CampaignStatus): Campaign | undefined;
  // Optimistic concurrency — DynamoDB equivalent: ConditionExpression on version attribute.
  // Returns undefined when the WHERE id=? AND version=? clause matched no rows.
  updateStatusConditional(
    id: string,
    status: CampaignStatus,
    version: number,
  ): Campaign | undefined;
  deleteById(id: string): boolean;
}

export class SqliteCampaignRepository implements CampaignRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindById: Database.Statement;
  private readonly stmtList: Database.Statement;
  private readonly stmtCount: Database.Statement;
  private readonly stmtUpdateStatus: Database.Statement;
  private readonly stmtUpdateStatusConditional: Database.Statement;
  private readonly stmtDelete: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO campaigns (id, name, publisherId, status, startDate, createdAt, version) VALUES (@id, @name, @publisherId, @status, @startDate, @createdAt, @version)',
    );
    this.stmtFindById = db.prepare('SELECT * FROM campaigns WHERE id = ?');
    this.stmtList = db.prepare(
      'SELECT * FROM campaigns WHERE publisherId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    );
    this.stmtCount = db.prepare(
      'SELECT COUNT(*) as total FROM campaigns WHERE publisherId = ?',
    );
    this.stmtUpdateStatus = db.prepare(
      'UPDATE campaigns SET status = ?, version = version + 1 WHERE id = ? RETURNING *',
    );
    this.stmtUpdateStatusConditional = db.prepare(
      'UPDATE campaigns SET status = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING *',
    );
    this.stmtDelete = db.prepare('DELETE FROM campaigns WHERE id = ?');
  }

  create(campaign: Campaign): Campaign {
    this.stmtInsert.run(campaign);
    return campaign;
  }

  findById(id: string): Campaign | undefined {
    return this.stmtFindById.get(id) as Campaign | undefined;
  }

  listByPublisher(opts: {
    publisherId: string;
    limit: number;
    offset: number;
  }): { data: Campaign[]; total: number } {
    const data = this.stmtList.all(opts.publisherId, opts.limit, opts.offset) as Campaign[];
    const row = this.stmtCount.get(opts.publisherId) as { total: number };
    return { data, total: row.total };
  }

  updateStatus(id: string, status: CampaignStatus): Campaign | undefined {
    return this.stmtUpdateStatus.get(status, id) as Campaign | undefined;
  }

  updateStatusConditional(
    id: string,
    status: CampaignStatus,
    version: number,
  ): Campaign | undefined {
    return this.stmtUpdateStatusConditional.get(status, id, version) as Campaign | undefined;
  }

  deleteById(id: string): boolean {
    const result = this.stmtDelete.run(id);
    return result.changes > 0;
  }
}
