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

  updateStatus(id: string, status: CampaignStatus): Campaign {
    const campaign = this.repo.findById(id);
    if (!campaign) throw AppError.notFound(`Campaign ${id} not found`);

    if (campaign.status === status) return campaign;

    const allowed = ALLOWED_TRANSITIONS[campaign.status];
    if (!allowed.includes(status)) {
      throw AppError.conflict(
        `Cannot transition campaign from '${campaign.status}' to '${status}'`,
      );
    }

    const updated = this.repo.updateStatus(id, status);
    return updated!;
  }

  delete(id: string): void {
    const deleted = this.repo.deleteById(id);
    if (!deleted) throw AppError.notFound(`Campaign ${id} not found`);
  }
}
