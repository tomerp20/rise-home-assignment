import Database from 'better-sqlite3';
import { Campaign, CampaignStatus } from './campaign.types';

export interface CampaignRepository {
  create(campaign: Campaign): Promise<Campaign>;
  findById(id: string): Promise<Campaign | undefined>;
  listByPublisher(opts: {
    publisherId: string;
    limit: number;
    offset: number;
  }): Promise<{ data: Campaign[]; total: number }>;
  // Single status-update port. When `expectedVersion` is supplied the write is
  // conditional (optimistic concurrency); otherwise it is an unconditional
  // last-write-wins update. Returns undefined when no row matched — i.e. the id
  // is gone, or (conditional path) the version no longer matches. The "conditional
  // vs unconditional" branch is a storage detail and stays inside the repo.
  // SQLite: WHERE id=? [AND version=?]. DynamoDB: ConditionExpression with/without version.
  updateStatus(
    id: string,
    status: CampaignStatus,
    expectedVersion?: number,
  ): Promise<Campaign | undefined>;
  deleteById(id: string): Promise<boolean>;
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
      // Deterministic order: createdAt is an ISO string, so same-millisecond rows
      // tie — id DESC is the stable tie-breaker that keeps LIMIT/OFFSET pages
      // free of skips/duplicates.
      'SELECT * FROM campaigns WHERE publisherId = ? ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?',
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

  async create(campaign: Campaign): Promise<Campaign> {
    this.stmtInsert.run(campaign);
    return campaign;
  }

  async findById(id: string): Promise<Campaign | undefined> {
    return this.stmtFindById.get(id) as Campaign | undefined;
  }

  async listByPublisher(opts: {
    publisherId: string;
    limit: number;
    offset: number;
  }): Promise<{ data: Campaign[]; total: number }> {
    const data = this.stmtList.all(opts.publisherId, opts.limit, opts.offset) as Campaign[];
    const row = this.stmtCount.get(opts.publisherId) as { total: number };
    return { data, total: row.total };
  }

  async updateStatus(
    id: string,
    status: CampaignStatus,
    expectedVersion?: number,
  ): Promise<Campaign | undefined> {
    if (expectedVersion !== undefined) {
      return this.stmtUpdateStatusConditional.get(status, id, expectedVersion) as
        | Campaign
        | undefined;
    }
    return this.stmtUpdateStatus.get(status, id) as Campaign | undefined;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = this.stmtDelete.run(id);
    return result.changes > 0;
  }
}
