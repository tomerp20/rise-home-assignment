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

  create(input: CreateCampaignInput): Campaign {
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

  getById(id: string): Campaign {
    const campaign = this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);
    return campaign;
  }

  list(query: ListCampaignsQuery): {
    data: Campaign[];
    pagination: { limit: number; offset: number; total: number };
  } {
    const { data, total } = this.repo.listByPublisher(query);
    return { data, pagination: { limit: query.limit, offset: query.offset, total } };
  }

  // State-machine check runs first; then the version/persistence guard.
  updateStatus(id: string, status: CampaignStatus, ifMatchVersion?: number): Campaign {
    const campaign = this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);

    if (campaign.status === status) return campaign;

    const allowed = ALLOWED_TRANSITIONS[campaign.status];
    if (!allowed.includes(status)) {
      throw AppError.conflict(
        `Cannot transition campaign from '${campaign.status}' to '${status}'`,
      );
    }

    if (ifMatchVersion !== undefined) {
      const updated = this.repo.updateStatusConditional(id, status, ifMatchVersion);
      if (!updated) throw AppError.versionConflict();
      return updated;
    }

    const updated = this.repo.updateStatus(id, status);
    return updated!;
  }

  getMetrics(id: string): { impressions: number; clicks: number; ctr: number } {
    const campaign = this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);

    const impressions = Math.floor(Math.random() * (1_000_000 - 1_000 + 1)) + 1_000;
    const clicks = Math.floor(Math.random() * (impressions + 1));
    const ctr = impressions === 0 ? 0 : Math.round((clicks / impressions) * 10_000) / 10_000;

    return { impressions, clicks, ctr };
  }

  delete(id: string): void {
    const deleted = this.repo.deleteById(id);
    if (!deleted) throw AppError.notFound(`Campaign ${id} not found`);
  }
}
