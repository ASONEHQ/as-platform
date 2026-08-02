import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Registry } from 'prom-client';

import type { DatabaseClient } from '@asone/database';

import { BackupVerificationService } from './backup-verification.service.js';
import { OPERATIONAL_EXIT, parseOperationalArguments, runOperationalCommand } from './cli.js';
import { loadOperationalThresholds } from './operational-config.js';
import { aggregateStatus, DEFAULT_OPERATIONAL_THRESHOLDS } from './operational-checks.types.js';
import { OperationalChecksService, withTimeout } from './operational-checks.service.js';
import type { OperationalChecksRepository } from './operational-checks.repository.js';
import { createOperationalMetrics } from './operational-metrics.js';
import { RestoreSafetyError, validateRestoreTarget } from './restore-safety.js';
import { ShadowRebuildService } from './shadow-rebuild.service.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('operational automation safety', () => {
  it('aggregates status by severity', () => {
    const base = {
      checked_at: new Date().toISOString(),
      duration_ms: 1,
      message: 'safe',
      metadata: {},
      critical: false,
    };
    expect(
      aggregateStatus([
        { ...base, name: 'one', status: 'healthy' },
        { ...base, name: 'two', status: 'degraded' },
      ]),
    ).toBe('degraded');
    expect(aggregateStatus([{ ...base, name: 'one', status: 'unknown' }])).toBe('unknown');
    expect(aggregateStatus([{ ...base, name: 'one', status: 'unhealthy' }])).toBe('unhealthy');
  });

  it('times out bounded checks', async () => {
    await expect(withTimeout(new Promise(() => undefined), 5)).rejects.toThrow('timed out');
  });

  it('aggregates blocking readiness and sanitized dependency failures', async () => {
    const repository = {
      databaseClock: vi.fn().mockResolvedValue(new Date()),
      migrationState: vi.fn().mockResolvedValue({ applied: 9, latest: 'safe' }),
      poolState: vi.fn().mockReturnValue({ total: 5, idle: 5, waiting: 0 }),
      outbox: vi.fn().mockResolvedValue({
        pending: 2,
        failed: 0,
        oldestPendingSeconds: 100,
        byEventType: {},
        byCompany: {},
      }),
      idempotency: vi.fn().mockResolvedValue({ incomplete: 0, expired: 0 }),
      inventory: vi.fn().mockResolvedValue({
        openCriticalFindings: 0,
        openWarningFindings: 0,
        acknowledgedFindings: 0,
        expiredCountLocks: 0,
        activeCounts: 0,
        shippedTransfers: 0,
        expiredActiveReservations: 0,
      }),
    } as unknown as OperationalChecksRepository;
    const infrastructure = {
      database: {} as DatabaseClient,
      checkReadiness: vi.fn().mockResolvedValue({ postgres: 'available', redis: 'unavailable' }),
      close: vi.fn(),
    };
    const report = await new OperationalChecksService(
      repository,
      infrastructure,
      DEFAULT_OPERATIONAL_THRESHOLDS,
    ).run();
    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.name === 'outbox.backlog')?.status).toBe('degraded');
    expect(JSON.stringify(report)).not.toContain('postgresql://');
  });

  it('registers only bounded-cardinality operational metric labels', async () => {
    const registry = new Registry();
    createOperationalMetrics(registry);
    const names = (await registry.getMetricsAsJSON()).map((metric) => metric.name);
    expect(names).toContain('asone_operational_check_status');
    expect(JSON.stringify(await registry.getMetricsAsJSON())).not.toMatch(
      /company_id|request_id|product_variant_id/,
    );
  });

  it('validates centralized thresholds', () => {
    expect(loadOperationalThresholds({})).toEqual(DEFAULT_OPERATIONAL_THRESHOLDS);
    expect(() =>
      loadOperationalThresholds({
        OPS_OUTBOX_WARNING_AGE_SECONDS: '500',
        OPS_OUTBOX_CRITICAL_AGE_SECONDS: '100',
      }),
    ).toThrow();
    expect(() =>
      loadOperationalThresholds({ OPS_RESTORE_ALLOWED_DATABASES: 'postgres' }),
    ).toThrow();
  });

  it('rejects dangerous restore targets', () => {
    const base = {
      sourceUrl: 'postgresql://redacted@localhost/source',
      allowedDatabases: ['asone_restore_test'],
      dryRun: true,
      confirmed: true,
      environment: 'test',
    };
    expect(() =>
      validateRestoreTarget({ ...base, targetUrl: 'postgresql://redacted@localhost/postgres' }),
    ).toThrow(RestoreSafetyError);
    expect(() => validateRestoreTarget({ ...base, targetUrl: base.sourceUrl })).toThrow(
      RestoreSafetyError,
    );
    expect(() =>
      validateRestoreTarget({
        ...base,
        targetUrl: 'postgresql://redacted@localhost/asone_restore_test',
        environment: 'production',
      }),
    ).toThrow(RestoreSafetyError);
    expect(() =>
      validateRestoreTarget({
        ...base,
        targetUrl: 'postgresql://redacted@localhost/asone_restore_test',
        dryRun: false,
      }),
    ).toThrow(RestoreSafetyError);
    expect(
      validateRestoreTarget({
        ...base,
        targetUrl: 'postgresql://redacted@localhost/asone_restore_test',
      }),
    ).toEqual({ database: 'asone_restore_test', safe: true, mode: 'dry-run' });
  });

  it('parses strict commands and rejects unknown input', () => {
    expect(parseOperationalArguments(['inventory', '--json', '--company-id', 'company'])).toEqual({
      command: 'inventory',
      values: { json: true, 'company-id': 'company' },
    });
    expect(() => parseOperationalArguments(['inventory', '--unknown'])).toThrow();
    expect(() => parseOperationalArguments(['inventory', 'unexpected'])).toThrow();
  });

  it('maps invalid and safety-rejected commands to stable exits', async () => {
    expect(await runOperationalCommand(['missing'], {})).toBe(OPERATIONAL_EXIT.invalid);
    expect(
      await runOperationalCommand(['shadow-rebuild'], {
        DATABASE_URL: 'postgresql://redacted@invalid/asone_test',
      }),
    ).toBe(OPERATIONAL_EXIT.invalid);
    expect(
      await runOperationalCommand(
        [
          'restore-validate',
          '--source-url',
          'postgresql://x/source',
          '--target-url',
          'postgresql://x/postgres',
          '--dry-run',
          '--confirm',
        ],
        { NODE_ENV: 'test' },
      ),
    ).toBe(OPERATIONAL_EXIT.rejected);
  });

  it('verifies a local backup manifest checksum and rejects invalid manifests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asone-backup-'));
    temporary.push(directory);
    const backup = join(directory, 'fixture.dump');
    const manifest = join(directory, 'manifest.json');
    await writeFile(backup, 'safe fixture');
    await writeFile(
      manifest,
      JSON.stringify({
        format_version: 1,
        backup_file: backup,
        checksum_sha256: createHash('sha256').update('safe fixture').digest('hex'),
        created_at: '2026-08-01T00:00:00.000Z',
        backup_type: 'fixture',
        encrypted: false,
      }),
    );
    await expect(new BackupVerificationService().verify(manifest)).resolves.toMatchObject({
      valid: true,
      checksum_valid: true,
    });
    await writeFile(manifest, '{}');
    await expect(new BackupVerificationService().verify(manifest)).rejects.toThrow('manifest');
  });

  it('never emits a connection string from invalid command handling', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runOperationalCommand(['outbox'], { DATABASE_URL: 'postgresql://secret@invalid/db' });
    expect(write.mock.calls.flat().join('')).not.toContain('secret');
    write.mockRestore();
  });

  it('scopes and chunks shadow rebuild without persisting detector findings', async () => {
    const readCandidateChunk = vi.fn().mockResolvedValue({
      items: [{ findingType: 'missing_balance' }, { findingType: 'balance_on_hand_drift' }],
      nextCursor: 'next',
      checkedCount: 2,
    });
    const service = new ShadowRebuildService({} as DatabaseClient, { readCandidateChunk });
    const result = await service.compare({ companyId: 'company', branchId: 'branch', limit: 2 });
    expect(readCandidateChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company',
        scope: { branchId: 'branch' },
        cursor: null,
        limit: 2,
      }),
    );
    expect(result).toMatchObject({
      balances_checked: 2,
      mismatches: 1,
      missing_balances: 1,
      complete: false,
      next_cursor: 'next',
    });
  });
});
