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

  async updateStatus(id: string, status: CampaignStatus, ifMatchVersion?: number): Promise<Campaign> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);

    if (campaign.status === status) return campaign;

    const allowed = ALLOWED_TRANSITIONS[campaign.status];
    if (!allowed.includes(status)) {
      throw AppError.conflict(
        `Cannot transition campaign from '${campaign.status}' to '${status}'`,
      );
    }

    if (ifMatchVersion !== undefined) {
      const updated = await this.repo.updateStatusConditional(id, status, ifMatchVersion);
      if (!updated) throw AppError.versionConflict();
      return updated;
    }

    const updated = await this.repo.updateStatus(id, status);
    return updated!;
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
