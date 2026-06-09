export type CampaignStatus = 'active' | 'paused' | 'ended';

export interface Campaign {
  id: string;
  name: string;
  publisherId: string;
  status: CampaignStatus;
  startDate: string;
  createdAt: string;
  version: number;
}
