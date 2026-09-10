import { createDatabaseClient } from '@asone/database';

import { isInteractive, promptPasswordMasked } from './password-prompt.js';
import { ProductionOwnerProvisioner } from './production-owner.service.js';
import { ProvisioningInputError, type ProvisionOwnerInput } from './production-owner.types.js';

/**
 * TASK 14.1 Part E — the operator-facing CLI wrapper.
 *
 *   pnpm --filter @asone/api provision:production-owner -- \
 *     --company-legal-name="Mi Tienda S.A. de C.V." \
 *     --company-slug=mi-tienda \
 *     --owner-name="Ana Owner" \
 *     --owner-email=ana@mi-tienda.mx \
 *     [--company-display-name="Mi Tienda"] \
 *     [--company-timezone=America/Mexico_City] [--company-currency=MXN] [--company-locale=es-MX] \
 *     [--branch-name="Sucursal Centro" --branch-code=CTR] \
 *     [--yes]
 *
 * See `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` for the full launch
 * procedure this fits into. Every text field above is REQUIRED (except
 * the bracketed ones) — there is no interactive prompting for them, so
 * this stays fully scriptable for a staging rehearsal or a documented
 * deploy runbook; the ONE field that gets special interactive/env-var
 * treatment is the password (Part E.10 "never print plaintext password
 * back to logs" / "prefer interactive hidden entry, else an explicit
 * secret env input"):
 *
 *   - if stdin/stdout are a real interactive TTY, you are prompted with
 *     masked (`*`) input — nothing is ever echoed or logged;
 *   - otherwise (a CI pipeline, a non-interactive deploy script), set
 *     PROVISION_OWNER_PASSWORD in the environment first. UNSET IT
 *     IMMEDIATELY AFTER THIS COMMAND FINISHES — it is real production
 *     credential material and should not linger in a shell's
 *     environment, a process manager's stored env, or shell history.
 *
 * `--yes` skips the final confirmation prompt (for scripted/rehearsal
 * use where an operator already reviewed the command before running
 * it); without it, and when interactive, you are shown exactly what
 * will be created — including which database (host + name, password
 * always redacted) this is about to write to — and must type `yes` to
 * proceed. Non-interactive without `--yes` is refused outright (Part
 * E.6 "must refuse to run accidentally in an unsafe/default
 * configuration" — a non-interactive run with no explicit `--yes` has
 * no way to have been reviewed by anyone).
 */

type CliFlags = Readonly<Record<string, string | true | undefined>>;

function parseFlags(argv: readonly string[]): CliFlags {
  const flags: Record<string, string | true> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex === -1) {
      flags[withoutPrefix] = true;
    } else {
      flags[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
    }
  }
  return flags;
}

function requireFlag(flags: CliFlags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new ProvisioningInputError(`Missing required flag --${name}=<value>.`);
  return value;
}

function optionalFlag(flags: CliFlags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

/** Redacts a `postgresql://user:PASSWORD@host/db` connection string down
 * to `postgresql://user:***@host/db` — this is the ONLY form of the
 * database URL ever printed to the operator, matching the same
 * never-print-a-secret discipline applied to the owner's own password. */
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

export async function runProductionOwnerProvisioning(
  argv: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let database;
  try {
    const flags = parseFlags(argv);

    const databaseUrl = optionalFlag(flags, 'database-url') ?? environment.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl.trim().length === 0)
      throw new ProvisioningInputError(
        'DATABASE_URL is required (env var, or --database-url=...).',
      );

    const input: Omit<ProvisionOwnerInput, 'ownerPassword'> = {
      companyLegalName: requireFlag(flags, 'company-legal-name'),
      companyDisplayName: optionalFlag(flags, 'company-display-name'),
      companySlug: requireFlag(flags, 'company-slug'),
      companyTimezone: optionalFlag(flags, 'company-timezone'),
      companyCurrencyCode: optionalFlag(flags, 'company-currency'),
      companyLocale: optionalFlag(flags, 'company-locale'),
      ownerDisplayName: requireFlag(flags, 'owner-name'),
      ownerEmail: requireFlag(flags, 'owner-email'),
      branchName: optionalFlag(flags, 'branch-name'),
      branchCode: optionalFlag(flags, 'branch-code'),
      branchTimezone: optionalFlag(flags, 'branch-timezone'),
    };

    let ownerPassword: string;
    if (isInteractive()) {
      ownerPassword = await promptPasswordMasked(`Password for ${input.ownerEmail}: `);
      const confirmPassword = await promptPasswordMasked('Confirm password: ');
      if (ownerPassword !== confirmPassword)
        throw new ProvisioningInputError('Passwords do not match.');
    } else {
      const fromEnv = environment.PROVISION_OWNER_PASSWORD;
      if (fromEnv === undefined || fromEnv.length === 0)
        throw new ProvisioningInputError(
          'Not running in an interactive terminal — set PROVISION_OWNER_PASSWORD in the environment first (and unset it immediately after this command finishes).',
        );
      ownerPassword = fromEnv;
    }

    const skipConfirmation = flags.yes === true;
    process.stdout.write('\nAbout to provision a new production company + owner:\n');
    process.stdout.write(`  Database:          ${redactDatabaseUrl(databaseUrl)}\n`);
    process.stdout.write(`  Company legal name: ${input.companyLegalName}\n`);
    process.stdout.write(`  Company slug:       ${input.companySlug}\n`);
    process.stdout.write(`  Owner:              ${input.ownerDisplayName} <${input.ownerEmail}>\n`);
    process.stdout.write(
      `  Branch:             ${input.branchName !== undefined ? `${input.branchName} (${input.branchCode ?? ''})` : '(none — create one later via the authenticated API)'}\n`,
    );
    if (!skipConfirmation) {
      if (!isInteractive())
        throw new ProvisioningInputError(
          'Refusing to run non-interactively without --yes — this action creates a real production tenant and cannot be undone by re-running this tool.',
        );
      const confirmed = await confirm('\nType "yes" to proceed: ');
      if (!confirmed) {
        process.stdout.write('Aborted — nothing was created.\n');
        return 1;
      }
    }

    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-production-owner-provisioning',
      // TASK 16.3A — see `@asone/config`'s `DATABASE_SSL_CA_CERT` doc
      // comment; this CLI bypasses `@asone/config` entirely (reads
      // DATABASE_URL directly, above), so it reads this one directly too.
      sslRootCert: environment.DATABASE_SSL_CA_CERT,
    });
    const summary = await new ProductionOwnerProvisioner(database).run({ ...input, ownerPassword });
    process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(
      '\nProvisioning complete. Log in at the API with the email/password just entered.\n',
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ success: false, error: error instanceof ProvisioningInputError ? error.message : error instanceof Error ? error.message : 'Provisioning failed.' })}\n`,
    );
    return 1;
  } finally {
    await database?.close();
  }
}

if (
  process.argv[1]?.endsWith('production-owner.cli.ts') === true ||
  process.argv[1]?.endsWith('production-owner.cli.js') === true
) {
  runProductionOwnerProvisioning()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
