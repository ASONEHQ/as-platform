import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { AuthService } from '../auth/auth.service.js';
import type {
  InventoryBalanceReadRepository,
  InventoryLocationRepository,
  InventoryMovementReadRepository,
} from './inventory.repository.js';
import { registerInventoryRoutes } from './inventory.routes.js';
import {
  InventoryBalanceReadService,
  InventoryLocationService,
  InventoryMovementReadService,
} from './inventory.service.js';
import type { InventoryLocation, InventoryMutationContext } from './inventory.types.js';

const context: InventoryMutationContext = {
  companyId: '00000000-0000-4000-8000-000000000001',
  actorId: '00000000-0000-4000-8000-000000000002',
  requestId: '00000000-0000-4000-8000-000000000003',
  correlationId: '00000000-0000-4000-8000-000000000004',
  timestamp: new Date('2026-07-27T00:00:00.000Z'),
};
const location: InventoryLocation = {
  id: '00000000-0000-4000-8000-000000000005',
  companyId: context.companyId,
  branchId: '00000000-0000-4000-8000-000000000006',
  code: 'MAIN',
  normalizedCode: 'main',
  name: 'Main',
  description: null,
  locationType: 'main',
  status: 'active',
  allowsReceiving: true,
  allowsIssuing: true,
  isDefault: true,
  version: 1n,
  createdAt: context.timestamp,
  updatedAt: context.timestamp,
  deletedAt: null,
};

describe('inventory E064-E068 application layer', () => {
  it('registers exactly the five canonical public routes', async () => {
    const app = Fastify();
    registerInventoryRoutes(
      app,
      {} as AuthService,
      {} as InventoryLocationService,
      {} as InventoryBalanceReadService,
      {} as InventoryMovementReadService,
    );
    await app.ready();
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain('/api/v1/inventory/locations (GET, HEAD, POST)');
    expect(routes).toContain('/:location_id (PATCH)');
    expect(routes).toContain('/api/v1/inventory/balances (GET, HEAD)');
    expect(routes).toContain('/api/v1/inventory/movements (GET, HEAD)');
    expect(routes).not.toContain('/api/v1/inventory/kardex');
    expect(routes).not.toContain('/api/v1/inventory/movements/:movement_id');
    await app.close();
  });

  it('normalizes location creation and delegates atomic idempotency', async () => {
    const insert = vi.fn(() => Promise.resolve(location));
    const auditAndPublish = vi.fn(() => Promise.resolve());
    const repository = {
      transaction: <T>(callback: (client: object) => Promise<T>) => callback({}),
      branchExists: vi.fn(() => Promise.resolve(true)),
      idempotentCreate: (
        _client: object,
        _context: InventoryMutationContext,
        _key: string,
        _hash: string,
        create: () => Promise<InventoryLocation>,
      ) => create().then((value) => ({ value, replayed: false })),
      insert,
      auditAndPublish,
    } as unknown as InventoryLocationRepository;
    const service = new InventoryLocationService(repository);
    const result = await service.create(context, 'key', {
      branchId: location.branchId,
      code: ' MAIN ',
      name: ' Main ',
      locationType: 'main',
      isDefault: true,
    });
    expect(result.value).toBe(location);
    expect(insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'MAIN', normalizedCode: 'main', name: 'Main' }),
    );
    expect(auditAndPublish).toHaveBeenCalledWith(
      expect.anything(),
      context,
      location,
      'inventory_location.created',
    );
  });

  it('conceals a location outside permitted branches during update', async () => {
    const repository = {
      transaction: <T>(callback: (client: object) => Promise<T>) => callback({}),
      lock: vi.fn(() => Promise.resolve(location)),
    } as unknown as InventoryLocationRepository;
    const service = new InventoryLocationService(repository);
    await expect(
      service.patch(context, [], location.id, 1n, { name: 'Changed' }),
    ).rejects.toMatchObject({ code: 'inventory_location_not_found' });
  });

  it('redacts costs for ordinary inventory readers', async () => {
    const repository = {
      list: vi.fn(() =>
        Promise.resolve({
          items: [
            {
              id: 'balance',
              quantity_on_hand: '10.000000',
              quantity_reserved: '2.000000',
              quantity_available: '8.000000',
              average_unit_cost: '4.5000',
              currency_code: 'MXN',
            },
          ],
          nextCursor: null,
        }),
      ),
    } as unknown as InventoryBalanceReadRepository;
    const service = new InventoryBalanceReadService(repository);
    const ordinary = await service.list(context.companyId, [location.branchId], false, {
      limit: 50,
    });
    expect(ordinary.items[0]).not.toHaveProperty('average_unit_cost');
    expect(ordinary.items[0]).not.toHaveProperty('currency_code');
    expect(ordinary.items[0]).toMatchObject({ quantity_available: '8.000000' });
    const privileged = await service.list(context.companyId, [location.branchId], true, {
      limit: 50,
    });
    expect(privileged.items[0]).toHaveProperty('average_unit_cost', '4.5000');
  });

  it('keeps movement reads delegated and read-only', async () => {
    const list = vi.fn(() =>
      Promise.resolve({
        items: [{ id: 'movement', status: 'posted', movement_type: 'adjustment' }],
        nextCursor: null,
      }),
    );
    const repository = {
      list,
    } as unknown as InventoryMovementReadRepository;
    const service = new InventoryMovementReadService(repository);
    const page = await service.list(context.companyId, [location.branchId], {
      limit: 50,
      status: 'posted',
    });
    expect(page.items).toHaveLength(1);
    expect(list).toHaveBeenCalledOnce();
  });
});
