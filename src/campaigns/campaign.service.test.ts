import { CampaignService } from './campaign.service';
import { CampaignRepository } from './campaign.repository';
import { Campaign } from './campaign.types';

// Lightweight in-memory repository — drives the service without touching SQLite.
function makeRepo(seed?: Campaign): CampaignRepository {
  const store = new Map<string, Campaign>(seed ? [[seed.id, seed]] : []);
  return {
    create: (c) => { store.set(c.id, c); return c; },
    findById: (id) => store.get(id),
    listByPublisher: ({ publisherId, limit, offset }) => {
      const all = [...store.values()].filter((c) => c.publisherId === publisherId);
      return { data: all.slice(offset, offset + limit), total: all.length };
    },
    updateStatus: (id, status) => {
      const c = store.get(id);
      if (!c) return undefined;
      const updated: Campaign = { ...c, status, version: c.version + 1 };
      store.set(id, updated);
      return updated;
    },
    updateStatusConditional: (id, status, version) => {
      const c = store.get(id);
      if (!c || c.version !== version) return undefined;
      const updated: Campaign = { ...c, status, version: c.version + 1 };
      store.set(id, updated);
      return updated;
    },
    deleteById: (id) => store.delete(id),
  };
}

function seedCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-test',
    name: 'Test Campaign',
    publisherId: 'pub-1',
    status: 'active',
    startDate: '2025-01-01',
    createdAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

describe('CampaignService.create', () => {
  it('generates a UUID id, ISO createdAt, and sets version to 1', () => {
    const service = new CampaignService(makeRepo());
    const result = service.create({ name: 'Campaign', publisherId: 'p1', startDate: '2025-01-01', status: 'active' });

    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt);
    expect(result.version).toBe(1);
  });

  it('stores all provided fields', () => {
    const service = new CampaignService(makeRepo());
    const result = service.create({ name: 'Launch', publisherId: 'pub-42', startDate: '2025-06-15', status: 'paused' });

    expect(result.name).toBe('Launch');
    expect(result.publisherId).toBe('pub-42');
    expect(result.startDate).toBe('2025-06-15');
    expect(result.status).toBe('paused');
  });
});

describe('CampaignService.updateStatus — state machine', () => {
  it('allows active → paused', () => {
    const c = seedCampaign({ status: 'active' });
    expect(new CampaignService(makeRepo(c)).updateStatus(c.id, 'paused').status).toBe('paused');
  });

  it('allows active → ended', () => {
    const c = seedCampaign({ status: 'active' });
    expect(new CampaignService(makeRepo(c)).updateStatus(c.id, 'ended').status).toBe('ended');
  });

  it('allows paused → active', () => {
    const c = seedCampaign({ status: 'paused' });
    expect(new CampaignService(makeRepo(c)).updateStatus(c.id, 'active').status).toBe('active');
  });

  it('allows paused → ended', () => {
    const c = seedCampaign({ status: 'paused' });
    expect(new CampaignService(makeRepo(c)).updateStatus(c.id, 'ended').status).toBe('ended');
  });

  it('throws 409 CONFLICT for ended → active', () => {
    const c = seedCampaign({ status: 'ended' });
    expect(() => new CampaignService(makeRepo(c)).updateStatus(c.id, 'active')).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'CONFLICT' }),
    );
  });

  it('throws 409 CONFLICT for ended → paused', () => {
    const c = seedCampaign({ status: 'ended' });
    expect(() => new CampaignService(makeRepo(c)).updateStatus(c.id, 'paused')).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'CONFLICT' }),
    );
  });

  it('is a no-op when status is unchanged — repo methods not called', () => {
    const c = seedCampaign({ status: 'active' });
    const repo = makeRepo(c);
    const updateSpy = jest.spyOn(repo, 'updateStatus');
    const conditionalSpy = jest.spyOn(repo, 'updateStatusConditional');

    const result = new CampaignService(repo).updateStatus(c.id, 'active');

    expect(result.status).toBe('active');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(conditionalSpy).not.toHaveBeenCalled();
  });

  it('throws 404 NOT_FOUND for an unknown campaign id', () => {
    expect(() => new CampaignService(makeRepo()).updateStatus('ghost', 'paused')).toThrow(
      expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }),
    );
  });

  it('uses conditional update when If-Match version matches', () => {
    const c = seedCampaign({ status: 'active', version: 1 });
    const result = new CampaignService(makeRepo(c)).updateStatus(c.id, 'paused', 1);
    expect(result.status).toBe('paused');
    expect(result.version).toBe(2);
  });

  it('throws 409 VERSION_CONFLICT when If-Match version is stale', () => {
    const c = seedCampaign({ status: 'active', version: 3 });
    expect(() => new CampaignService(makeRepo(c)).updateStatus(c.id, 'paused', 1)).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'VERSION_CONFLICT' }),
    );
  });
});

describe('CampaignService.getMetrics', () => {
  it('throws 404 NOT_FOUND for an unknown campaign id', () => {
    expect(() => new CampaignService(makeRepo()).getMetrics('ghost')).toThrow(
      expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }),
    );
  });

  it('returns impressions, clicks, and ctr in valid ranges for a known campaign', () => {
    const c = seedCampaign();
    const result = new CampaignService(makeRepo(c)).getMetrics(c.id);
    expect(result.impressions).toBeGreaterThanOrEqual(1000);
    expect(result.clicks).toBeGreaterThanOrEqual(0);
    expect(result.clicks).toBeLessThanOrEqual(result.impressions);
    expect(result.ctr).toBeGreaterThanOrEqual(0);
    expect(result.ctr).toBeLessThanOrEqual(1);
  });
});
