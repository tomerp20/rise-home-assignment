import crypto from 'crypto';
import { Campaign, CampaignStatus } from './campaign.types';
import { CampaignRepository } from './campaign.repository';
import { CreateCampaignInput, ListCampaignsQuery } from './campaign.schema';
import { AppError } from '../errors/app-error';

const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

export class CampaignService {
  constructor(private readonly repo: CampaignRepository) {}

  async create(input: CreateCampaignInput): Promise<Campaign> {
    const campaign: Campaign = {
      id: crypto.randomUUID(),
      name: input.name,
      publisherId: input.publisherId,
      status: input.status,
      startDate: input.startDate,
      createdAt: new Date().toISOString(),
      version: 1,
    };
    return this.repo.create(campaign);
  }

  async getById(id: string): Promise<Campaign> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);
    return campaign;
  }

  async list(query: ListCampaignsQuery): Promise<{
    data: Campaign[];
    pagination: { limit: number; offset: number; total: number };
  }> {
    const { data, total } = await this.repo.listByPublisher(query);
    return { data, pagination: { limit: query.limit, offset: query.offset, total } };
  }

  /**
   * Update a campaign's status, optionally guarded by optimistic concurrency.
   *
   * Optimistic concurrency is OPT-IN: when the caller supplies `If-Match`
   * (`ifMatchVersion`) we do a conditional update and reject stale writes with
   * 412 Precondition Failed; without it we fall back to last-write-wins. This is a
   * deliberate design choice — it keeps the default `PATCH /campaigns/:id { status }`
   * simple (no header required) per the spec, while still letting careful clients
   * opt into conflict detection.
   *
   * Per RFC 7232 the If-Match precondition is evaluated FIRST — before the no-op
   * shortcut and the transition check — so a stale If-Match is rejected even when
   * the requested status equals the current one.
   */
  async updateStatus(id: string, status: CampaignStatus, ifMatchVersion?: number): Promise<Campaign> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);

    // Precondition first (RFC 7232) — before the no-op/transition checks below.
    if (ifMatchVersion !== undefined && ifMatchVersion !== campaign.version) {
      throw AppError.preconditionFailed();
    }

    if (campaign.status === status) return campaign;

    const allowed = ALLOWED_TRANSITIONS[campaign.status];
    if (!allowed.includes(status)) {
      throw AppError.conflict(
        `Cannot transition campaign from '${campaign.status}' to '${status}'`,
      );
    }

    // Single call site: pass the version only when the caller opted in.
    const updated = await this.repo.updateStatus(id, status, ifMatchVersion);
    if (!updated) {
      // No row matched between our findById and the write: version moved under us
      // (opt-in path → 412) or the row was deleted concurrently (→ 404).
      throw ifMatchVersion !== undefined
        ? AppError.preconditionFailed()
        : AppError.notFound(`Campaign ${id} not found`);
    }
    return updated;
  }

  async getMetrics(id: string): Promise<{ impressions: number; clicks: number; ctr: number }> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);

    const impressions = Math.floor(Math.random() * (1_000_000 - 1_000 + 1)) + 1_000;
    const clicks = Math.floor(Math.random() * (impressions + 1));
    const ctr = impressions === 0 ? 0 : Math.round((clicks / impressions) * 10_000) / 10_000;

    return { impressions, clicks, ctr };
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.repo.deleteById(id);
    if (!deleted) throw AppError.notFound(`Campaign ${id} not found`);
  }
}
