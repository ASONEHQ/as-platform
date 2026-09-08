import { readFile } from 'node:fs/promises';

import { createDatabaseClient } from '@asone/database';

import { isInteractive, promptPasswordMasked } from '../provisioning/password-prompt.js';
import { BusinessConfigProvisioner } from './business-config.service.js';
import { BusinessConfigInputError, type LaunchUserConfig, type ResolveUserPassword } from './business-config.types.js';
import { validateLaunchConfig } from './launch-config.validate.js';

/**
 * TASK 14.2 Part D — the operator-facing CLI wrapper, structured exactly
 * like `../provisioning/production-owner.cli.ts` (parse flags → build a
 * summary → confirm → run → print). See `business-config.service.ts`'s
 * own doc comment for what this tool does and does not do.
 *
 *   pnpm --filter @asone/api provision:business-config -- \
 *     --config=config/launch/inflapark.launch.example.json \
 *     [--database-url=postgresql://...] \
 *     [--dry-run] \
 *     [--users-password-env-prefix=INFLAPARK_LAUNCH] \
 *     [--yes]
 *
 * Passwords for brand-new `users` entries (TASK 14.2 Part D.3 — "no
 * passwords in the launch config, ever"):
 *
 *   - `--dry-run` never needs a password at all (nothing is created).
 *   - interactive TTY: each new user is prompted twice, masked, exactly
 *     like `production-owner.cli.ts` prompts for the owner's own
 *     password (reusing the same `password-prompt.ts` helper — never a
 *     second copy of that raw-mode-stdin logic).
 *   - non-interactive (CI/scripted): pass `--users-password-env-prefix=
 *     <PREFIX>`; for the Nth new user (0-based index into this config's
 *     own "users" array) with email `E`, the password is read from
 *     whichever of these two environment variables is set (checked in
 *     this order):
 *       1. `<PREFIX>_<SANITIZED_EMAIL>` — `E` uppercased with every
 *          run of non-alphanumeric characters collapsed to a single `_`
 *          (e.g. `ana.perez@inflapark.mx` → `ANA_PEREZ_INFLAPARK_MX`).
 *       2. `<PREFIX>_USER_<N>` — a positional fallback when the email
 *          itself is inconvenient to embed in an env var name.
 *     UNSET every such variable immediately after this command finishes
 *     — like `PROVISION_OWNER_PASSWORD`, this is real credential
 *     material and must not linger in a shell's environment or history.
 */

type CliFlags = Readonly<Record<string, string | true | undefined>>;

function parseFlags(argv: readonly string[]): CliFlags {
  const flags: Record<string, string | true> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex === -1) flags[withoutPrefix] = true;
    else flags[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
  }
  return flags;
}

function requireFlag(flags: CliFlags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new BusinessConfigInputError(`Missing required flag --${name}=<value>.`);
  return value;
}

function optionalFlag(flags: CliFlags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

/** Duplicated (not imported) from `production-owner.cli.ts`, which does
 * not export it — this is the same 4-line redaction logic, kept
 * byte-for-byte equivalent so the two tools never print a database URL
 * differently. */
function redactDatabaseUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.password.length > 0) url.password = '***';
    return url.toString();
  } catch {
    return '(unparseable DATABASE_URL — refusing to print it in case it embeds a credential)';
  }
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(question);
  return new Promise<boolean>((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data: string) => {
      process.stdin.pause();
      resolve(data.trim().toLowerCase() === 'yes');
    });
  });
}

function sanitizeEmailForEnvVar(email: string): string {
  return email
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function buildEnvPasswordResolver(prefix: string, environment: NodeJS.ProcessEnv): ResolveUserPassword {
  return (user: LaunchUserConfig, index: number) => {
    const byEmailName = `${prefix}_${sanitizeEmailForEnvVar(user.email)}`;
    const byEmail = environment[byEmailName];
    if (byEmail !== undefined && byEmail.length > 0) return Promise.resolve(byEmail);
    const byIndexName = `${prefix}_USER_${index.toString()}`;
    const byIndex = environment[byIndexName];
    if (byIndex !== undefined && byIndex.length > 0) return Promise.resolve(byIndex);
    throw new BusinessConfigInputError(
      `No password was found for new user "${user.email}" (users[${index.toString()}]) — set ${byEmailName} or ${byIndexName} in the environment first.`,
    );
  };
}

function buildInteractivePasswordResolver(): ResolveUserPassword {
  return async (user: LaunchUserConfig) => {
    const password = await promptPasswordMasked(`Password for new user ${user.email} (role ${user.role_code}): `);
    const confirmPassword = await promptPasswordMasked('Confirm password: ');
    if (password !== confirmPassword) throw new BusinessConfigInputError('Passwords do not match.');
    return password;
  };
}

export async function runBusinessConfigProvisioning(
  argv: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let database;
  try {
    const flags = parseFlags(argv);
    const configPath = requireFlag(flags, 'config');
    const dryRun = flags['dry-run'] === true;

    const databaseUrl = optionalFlag(flags, 'database-url') ?? environment.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl.trim().length === 0)
      throw new BusinessConfigInputError('DATABASE_URL is required (env var, or --database-url=...).');

    const rawConfig: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    const config = validateLaunchConfig(rawConfig);

    let resolveUserPassword: ResolveUserPassword | undefined;
    if (!dryRun && config.users.length > 0) {
      if (isInteractive()) resolveUserPassword = buildInteractivePasswordResolver();
      else {
        const prefix = optionalFlag(flags, 'users-password-env-prefix');
        if (prefix === undefined)
          throw new BusinessConfigInputError(
            'Not running in an interactive terminal and this config has "users" entries — set --users-password-env-prefix=<PREFIX> and the corresponding environment variable(s) first (see this file\'s own top-of-file doc comment).',
          );
        resolveUserPassword = buildEnvPasswordResolver(prefix, environment);
      }
    }

    const skipConfirmation = flags.yes === true || dryRun;
    process.stdout.write('\nAbout to apply a business launch configuration:\n');
    process.stdout.write(`  Database:      ${redactDatabaseUrl(databaseUrl)}\n`);
    process.stdout.write(`  Config file:   ${configPath}\n`);
    process.stdout.write(`  Company slug:  ${config.company.slug}\n`);
    process.stdout.write(`  Mode:          ${dryRun ? 'DRY RUN — no writes will be made' : 'REAL — will write to the database above'}\n`);
    if (!skipConfirmation) {
      if (!isInteractive())
        throw new BusinessConfigInputError(
          'Refusing to run non-interactively without --yes — this action writes real business configuration and cannot be undone by re-running this tool.',
        );
      const confirmed = await confirm('\nType "yes" to proceed: ');
      if (!confirmed) {
        process.stdout.write('Aborted — nothing was created.\n');
        return 1;
      }
    }

    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-business-config-provisioning',
    });
    const summary = await new BusinessConfigProvisioner(database).run(config, { dryRun, resolveUserPassword });
    process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);

    const conflictSections: readonly [string, readonly string[]][] = [
      ['products', summary.products.conflicts],
    ];
    for (const [section, conflicts] of conflictSections) {
      if (conflicts.length === 0) continue;
      process.stdout.write(`\nWARNING — ${conflicts.length.toString()} conflict(s) in "${section}" were skipped, not overwritten:\n`);
      for (const conflict of conflicts) process.stdout.write(`  - ${conflict}\n`);
    }

    process.stdout.write(dryRun ? '\nDry run complete — nothing was written.\n' : '\nBusiness configuration applied.\n');
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        success: false,
        error: error instanceof BusinessConfigInputError ? error.message : error instanceof Error ? error.message : 'Business configuration failed.',
      })}\n`,
    );
    return 1;
  } finally {
    await database?.close();
  }
}

if (
  process.argv[1]?.endsWith('business-config.cli.ts') === true ||
  process.argv[1]?.endsWith('business-config.cli.js') === true
) {
  runBusinessConfigProvisioning()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
