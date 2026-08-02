export interface RestoreSafetyInput {
  readonly sourceUrl: string;
  readonly targetUrl: string;
  readonly allowedDatabases: readonly string[];
  readonly dryRun: boolean;
  readonly environment: string;
  readonly confirmed: boolean;
}

export class RestoreSafetyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RestoreSafetyError';
  }
}

function parsed(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new RestoreSafetyError('Database target is invalid.');
  }
}

export function validateRestoreTarget(
  input: RestoreSafetyInput,
): Readonly<{ database: string; safe: true; mode: 'dry-run' }> {
  const source = parsed(input.sourceUrl);
  const target = parsed(input.targetUrl);
  const database = target.pathname.replace(/^\//, '');
  if (['postgres', 'template0', 'template1'].includes(database))
    throw new RestoreSafetyError('Protected database target rejected.');
  if (!input.allowedDatabases.includes(database))
    throw new RestoreSafetyError('Database target is not allowlisted.');
  if (input.environment === 'production')
    throw new RestoreSafetyError('Restore validation is disabled in production.');
  if (!input.dryRun || !input.confirmed)
    throw new RestoreSafetyError('Explicit dry-run confirmation is required.');
  if (source.href === target.href)
    throw new RestoreSafetyError('Restore source and target must differ.');
  if (
    process.env.DATABASE_URL !== undefined &&
    parsed(process.env.DATABASE_URL).href === target.href
  ) {
    throw new RestoreSafetyError('Application DATABASE_URL cannot be a restore target.');
  }
  return Object.freeze({ database, safe: true, mode: 'dry-run' });
}
