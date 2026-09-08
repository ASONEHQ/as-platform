/// TASK 14.5A: orchestrates a real logo upload/delete against the real
/// MinIO object store (`branding.storage.ts`) and the real, already-CAS-
/// guarded `branding.logo_url` company setting
/// (`SettingsService.mutateCompanySetting` -- the SAME mechanism every
/// other company setting write in this codebase already uses, per this
/// task's own instructions; no bespoke persistence path is invented
/// here).
import type {
  AuditedSettingMutation,
  SettingMutationResult,
  SettingsScope,
  SettingsService,
} from '../settings/settings.service.js';
import type { BrandingObjectStorage } from './branding.storage.js';

const LOGO_SETTING_KEY = 'branding.logo_url';

export interface LogoUploadInput {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly extension: string;
  readonly expectedVersion: bigint;
  readonly actorId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly timestamp: Date;
}

export interface LogoDeleteInput {
  readonly expectedVersion: bigint;
  readonly actorId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly timestamp: Date;
}

export class BrandingService {
  public constructor(
    private readonly settings: SettingsService,
    private readonly storage: BrandingObjectStorage,
  ) {}

  /** Uploads the real bytes to MinIO, then persists the resulting object
   * URL into `branding.logo_url` through the normal CAS-guarded settings
   * write. If the settings write itself fails (most commonly a 409
   * version conflict from a concurrent editor), the just-uploaded object
   * is best-effort cleaned up so a rejected request never leaves an
   * orphaned file behind. */
  public async uploadLogo(
    scope: SettingsScope,
    input: LogoUploadInput,
  ): Promise<SettingMutationResult> {
    const uploaded = await this.storage.uploadLogo(
      scope.companyId,
      input.buffer,
      input.contentType,
      input.extension,
    );
    const mutation: AuditedSettingMutation = {
      key: LOGO_SETTING_KEY,
      value: uploaded.url,
      valueType: 'string',
      expectedVersion: input.expectedVersion,
      actorId: input.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
      timestamp: input.timestamp,
    };
    try {
      return await this.settings.mutateCompanySetting(scope, mutation, 'active');
    } catch (error) {
      await this.storage.deleteObjectBestEffort(uploaded.key);
      throw error;
    }
  }

  /** Retires `branding.logo_url` back to unset (the catalog's own `''`
   * default, exactly like `receipts.header_text`'s "clear the text" path)
   * through the same CAS-guarded write, then best-effort deletes the
   * previously-uploaded object from MinIO. The object is looked up BEFORE
   * the mutation so the delete can proceed even though the setting row no
   * longer carries the URL afterward. */
  public async deleteLogo(
    scope: SettingsScope,
    input: LogoDeleteInput,
  ): Promise<SettingMutationResult> {
    const before = await this.settings.effectiveCompanySettings(scope, [LOGO_SETTING_KEY]);
    const previousUrl = before.settings.find((setting) => setting.key === LOGO_SETTING_KEY)?.value;
    const mutation: AuditedSettingMutation = {
      key: LOGO_SETTING_KEY,
      value: '',
      valueType: 'string',
      expectedVersion: input.expectedVersion,
      actorId: input.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
      timestamp: input.timestamp,
    };
    const result = await this.settings.mutateCompanySetting(scope, mutation, 'retired');
    if (typeof previousUrl === 'string' && previousUrl.length > 0) {
      const key = this.storage.keyFromUrl(previousUrl);
      if (key !== undefined) await this.storage.deleteObjectBestEffort(key);
    }
    return result;
  }
}
