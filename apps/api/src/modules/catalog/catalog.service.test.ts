import { describe, expect, it } from 'vitest';

import { CatalogService } from './catalog.service.js';
import { CatalogApplicationError } from './catalog.types.js';
import type { CatalogRepository } from './catalog.repository.js';

const context = {
  companyId: '00000000-0000-4000-8000-000000000001',
  actorId: '00000000-0000-4000-8000-000000000002',
  requestId: 'request',
  correlationId: 'correlation',
  timestamp: new Date('2026-07-27T00:00:00.000Z'),
};

describe('catalog application service', () => {
  it('rejects invalid normalized catalog codes before repository access', () => {
    const service = new CatalogService({} as CatalogRepository);
    expect(() => service.createBrand(context, 'key', { code: 'bad code', name: 'Brand' })).toThrow(
      CatalogApplicationError,
    );
  });
});
