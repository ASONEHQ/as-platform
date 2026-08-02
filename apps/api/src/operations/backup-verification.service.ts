import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

export interface BackupManifest {
  readonly format_version: 1;
  readonly backup_file: string;
  readonly checksum_sha256: string;
  readonly created_at: string;
  readonly backup_type: 'fixture' | 'base' | 'logical';
  readonly encrypted?: boolean;
  readonly retention_until?: string;
}

async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

export class BackupVerificationService {
  public async verify(manifestPath: string): Promise<Readonly<Record<string, unknown>>> {
    const raw: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!isManifest(raw)) throw new Error('Backup manifest is invalid.');
    const info = await stat(raw.backup_file);
    if (!info.isFile() || info.size <= 0) throw new Error('Backup file is empty or unavailable.');
    const actualChecksum = await checksum(raw.backup_file);
    if (actualChecksum !== raw.checksum_sha256) throw new Error('Backup checksum mismatch.');
    return Object.freeze({
      valid: true,
      size_bytes: info.size,
      checksum_valid: true,
      created_at: raw.created_at,
      backup_type: raw.backup_type,
      encrypted: raw.encrypted ?? null,
      retention_declared: raw.retention_until !== undefined,
      format_version: raw.format_version,
    });
  }
}

function isManifest(value: unknown): value is BackupManifest {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.format_version === 1 &&
    typeof item.backup_file === 'string' &&
    typeof item.checksum_sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(item.checksum_sha256) &&
    typeof item.created_at === 'string' &&
    !Number.isNaN(Date.parse(item.created_at)) &&
    ['fixture', 'base', 'logical'].includes(String(item.backup_type))
  );
}
