import { z } from 'zod';

export const createCampaignSchema = z.object({
  name: z.string().min(1),
  publisherId: z.string().min(1),
  startDate: z.string().date(),
  status: z.enum(['active', 'paused']).optional().default('active'),
});

export const patchCampaignSchema = z
  .object({
    status: z.enum(['active', 'paused', 'ended']),
  })
  .strict();

export const listCampaignsQuerySchema = z.object({
  publisherId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type PatchCampaignInput = z.infer<typeof patchCampaignSchema>;
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
