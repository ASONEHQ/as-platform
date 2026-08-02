import { createDatabaseClient } from '@asone/database';

import { createInfrastructure } from '../infrastructure/dependencies.js';
import { BackupVerificationService } from './backup-verification.service.js';
import { loadOperationalThresholds } from './operational-config.js';
import { createOperationalChecksService } from './operational-checks.service.js';
import { OperationalChecksRepository } from './operational-checks.repository.js';
import { RestoreSafetyError, validateRestoreTarget } from './restore-safety.js';
import { ShadowRebuildService } from './shadow-rebuild.service.js';

export const OPERATIONAL_EXIT = Object.freeze({
  success: 0,
  degraded: 1,
  invalid: 2,
  unavailable: 3,
  rejected: 4,
  internal: 5,
});

interface Arguments {
  readonly command: string;
  readonly values: Readonly<Record<string, string | true>>;
}
class OperationalArgumentError extends Error {}
const COMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  check: ['json', 'timeout'],
  readiness: ['json', 'timeout'],
  outbox: ['json', 'timeout'],
  inventory: ['json', 'timeout', 'company-id'],
  'shadow-rebuild': [
    'json',
    'timeout',
    'company-id',
    'branch-id',
    'location-id',
    'product-variant-id',
    'cursor',
  ],
  'backup-verify': ['json', 'timeout', 'manifest'],
  'restore-validate': ['json', 'timeout', 'source-url', 'target-url', 'dry-run', 'confirm'],
  help: [],
});

export function parseOperationalArguments(argv: readonly string[]): Arguments {
  const command = argv[0] ?? 'help';
  const allowed = COMMAND_FLAGS[command];
  if (allowed === undefined) throw new Error('Unknown operational command.');
  const values: Record<string, string | true> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) throw new Error('Unexpected positional argument.');
    const name = token.slice(2);
    if (!allowed.includes(name) || Object.hasOwn(values, name))
      throw new Error('Unknown or duplicate argument.');
    if (name === 'json' || name === 'dry-run' || name === 'confirm') values[name] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--'))
        throw new Error('Argument value is required.');
      values[name] = value;
      index += 1;
    }
  }
  return { command, values: Object.freeze(values) };
}

function required(value: string | true | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new OperationalArgumentError(`${name} is required.`);
  return value;
}

function output(value: unknown, json: boolean): void {
  process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

export async function runOperationalCommand(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let input: Arguments;
  try {
    input = parseOperationalArguments(argv);
  } catch {
    return OPERATIONAL_EXIT.invalid;
  }
  if (input.command === 'help') {
    output(
      {
        commands: Object.keys(COMMAND_FLAGS),
        safety: 'read-only; restore validation is dry-run only',
      },
      input.values.json === true,
    );
    return OPERATIONAL_EXIT.success;
  }
  let thresholds;
  try {
    thresholds = loadOperationalThresholds({
      ...environment,
      OPS_CHECK_TIMEOUT_MS:
        typeof input.values.timeout === 'string'
          ? input.values.timeout
          : environment.OPS_CHECK_TIMEOUT_MS,
    });
  } catch {
    return OPERATIONAL_EXIT.invalid;
  }
  try {
    if (input.command === 'backup-verify') {
      output(
        await new BackupVerificationService().verify(required(input.values.manifest, 'manifest')),
        input.values.json === true,
      );
      return OPERATIONAL_EXIT.success;
    }
    if (input.command === 'restore-validate') {
      output(
        validateRestoreTarget({
          sourceUrl: required(input.values['source-url'], 'source-url'),
          targetUrl: required(input.values['target-url'], 'target-url'),
          allowedDatabases: thresholds.restoreAllowedDatabases,
          dryRun: input.values['dry-run'] === true,
          confirmed: input.values.confirm === true,
          environment: environment.NODE_ENV ?? 'development',
        }),
        input.values.json === true,
      );
      return OPERATIONAL_EXIT.success;
    }
    const databaseUrl = required(environment.DATABASE_URL, 'DATABASE_URL');
    if (input.command === 'check' || input.command === 'readiness') {
      const infrastructure = createInfrastructure({
        databaseUrl,
        redisUrl: required(environment.REDIS_URL, 'REDIS_URL'),
        connectionTimeoutMs: thresholds.checkTimeoutMs,
      });
      try {
        const report = await createOperationalChecksService({ infrastructure, thresholds }).run();
        output(report, input.values.json === true);
        return report.status === 'healthy' ? OPERATIONAL_EXIT.success : OPERATIONAL_EXIT.degraded;
      } finally {
        await infrastructure.close();
      }
    }
    const database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-operations',
      connectionTimeoutMs: thresholds.checkTimeoutMs,
    });
    try {
      if (input.command === 'outbox') {
        const value = await new OperationalChecksRepository(database).outbox();
        output(value, input.values.json === true);
        return value.failed > 0 || value.oldestPendingSeconds >= thresholds.outboxWarningAgeSeconds
          ? OPERATIONAL_EXIT.degraded
          : OPERATIONAL_EXIT.success;
      }
      if (input.command === 'inventory') {
        const value = await new OperationalChecksRepository(database).inventory(
          typeof input.values['company-id'] === 'string' ? input.values['company-id'] : undefined,
        );
        output(value, input.values.json === true);
        return value.openCriticalFindings > 0 || value.expiredCountLocks > 0
          ? OPERATIONAL_EXIT.degraded
          : OPERATIONAL_EXIT.success;
      }
      if (input.command === 'shadow-rebuild') {
        const value = await new ShadowRebuildService(database).compare({
          companyId: required(input.values['company-id'], 'company-id'),
          ...(typeof input.values['branch-id'] === 'string'
            ? { branchId: input.values['branch-id'] }
            : {}),
          ...(typeof input.values['location-id'] === 'string'
            ? { locationId: input.values['location-id'] }
            : {}),
          ...(typeof input.values['product-variant-id'] === 'string'
            ? { productVariantId: input.values['product-variant-id'] }
            : {}),
          ...(typeof input.values.cursor === 'string' ? { cursor: input.values.cursor } : {}),
          limit: thresholds.shadowRebuildChunkSize,
        });
        output(value, input.values.json === true);
        return Number(value.mismatches) > 0 || Number(value.missing_balances) > 0
          ? OPERATIONAL_EXIT.degraded
          : OPERATIONAL_EXIT.success;
      }
      return OPERATIONAL_EXIT.success;
    } finally {
      await database.close();
    }
  } catch (error) {
    if (error instanceof OperationalArgumentError) return OPERATIONAL_EXIT.invalid;
    if (error instanceof RestoreSafetyError) return OPERATIONAL_EXIT.rejected;
    return OPERATIONAL_EXIT.unavailable;
  }
}

const entryPoint = process.argv[1];
if (entryPoint?.endsWith('cli.ts') === true || entryPoint?.endsWith('cli.js') === true) {
  runOperationalCommand(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = OPERATIONAL_EXIT.internal;
    });
}
