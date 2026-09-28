/// TASK 17.1 — the CRITICAL cross-tenant regression test for the
/// branding-logo object-storage deletion vulnerability found during
/// TASK 17.0. `branding.logo_url` is a plain, tenant-writable settings
/// string (see `settings.catalog.ts`): a caller with `company_settings
/// .update` can write ANY string into it directly through
/// `PUT /companies/{id}/settings/branding.logo_url`, including another
/// company's real, publicly-readable logo URL. `BrandingService
/// .deleteLogo` must never issue a real `DeleteObject` for a key it
/// cannot prove belongs to the acting company — this file proves that at
/// the service layer by instrumenting (spying on) the storage
/// dependency's `deleteObjectBestEffort` call, not merely asserting an
/// HTTP status (which would pass either way, since the setting mutation
/// itself always succeeds regardless of whether cleanup happens).
import { describe, expect, it, vi } from 'vitest';

import { BrandingService, type LogoDeleteInput } from './branding.service.js';
import type { BrandingObjectStorage } from './branding.storage.js';
import type {
  ResolvedSettings,
  SettingMutationResult,
  SettingsScope,
  SettingsService,
} from '../settings/settings.service.js';
import type { EffectiveSetting, PersistedSetting } from '../settings/settings.types.js';

const COMPANY_A = '11111111-1111-1111-1111-111111111111';
const COMPANY_B = '22222222-2222-2222-2222-222222222222';

/** Plain, arrow-typed doubles — deliberately NOT typed as the real
 * `BrandingObjectStorage`/`SettingsService` classes at the point of
 * declaration (only cast to those types where actually injected), so
 * `expect(storage.deleteObjectBestEffort)` references a plain function
 * property rather than a class method, matching the same pattern already
 * used by `settings.routes.test.ts`'s own `ServiceDouble`. */
interface StorageDouble {
  keyFromUrl: ReturnType<typeof vi.fn>;
  isOwnedKey: ReturnType<typeof vi.fn>;
  deleteObjectBestEffort: ReturnType<typeof vi.fn>;
}

interface SettingsDouble {
  effectiveCompanySettings: ReturnType<typeof vi.fn>;
  mutateCompanySetting: ReturnType<typeof vi.fn>;
}

function effectiveSetting(value: string): EffectiveSetting {
  return { key: 'branding.logo_url', type: 'string', value, source: 'company', version: 1n };
}

function resolved(value: string): ResolvedSettings {
  return { settings: [effectiveSetting(value)], checkpoint: 'checkpoint' };
}

function persistedSetting(): PersistedSetting {
  return {
    id: 'setting-id',
    key: 'branding.logo_url',
    value: '',
    valueType: 'string',
    status: 'retired',
    version: 2n,
    createdAt: new Date('2026-09-28T00:00:00.000Z'),
    updatedAt: new Date('2026-09-28T00:00:00.000Z'),
    deletedAt: null,
  };
}

function mutationResult(): SettingMutationResult {
  return { persisted: persistedSetting(), effective: effectiveSetting('') };
}

function deleteInput(): LogoDeleteInput {
  return {
    expectedVersion: 1n,
    actorId: 'actor',
    requestId: 'request',
    correlationId: 'correlation',
    timestamp: new Date('2026-09-28T00:00:00.000Z'),
  };
}

/** A real `BrandingObjectStorage`-shaped fake whose `keyFromUrl`/
 * `isOwnedKey` implement the SAME real ownership rule the production class
 * delegates to `S3ObjectStorage` for — this is deliberately not a bare
 * `vi.fn()` stub returning `true`/`false` by fiat, so the test exercises
 * the actual "does this key's company segment match?" logic, not a
 * tautology. `deleteObjectBestEffort` IS a bare spy — that is the call
 * this test's assertions are about. */
function fakeStorage(): StorageDouble {
  const prefix = 'logos';
  const bucket = 'asone-branding';
  const baseUrl = 'http://127.0.0.1:9000';
  return {
    keyFromUrl: vi.fn((url: string): string | undefined => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return undefined;
      }
      if (parsed.origin !== new URL(baseUrl).origin) return undefined;
      const marker = `/${bucket}/`;
      const index = parsed.pathname.indexOf(marker);
      if (index === -1) return undefined;
      const key = parsed.pathname.slice(index + marker.length);
      return key.length === 0 ? undefined : key;
    }),
    isOwnedKey: vi.fn((key: string, companyId: string): boolean => {
      const segments = key.split('/');
      return (
        segments.length === 3 &&
        segments[0] === prefix &&
        segments[1] === companyId &&
        (segments[2]?.length ?? 0) > 0
      );
    }),
    deleteObjectBestEffort: vi.fn(() => Promise.resolve()),
  };
}

function fakeSettings(previousUrl: string): SettingsDouble {
  return {
    effectiveCompanySettings: vi.fn(() => Promise.resolve(resolved(previousUrl))),
    mutateCompanySetting: vi.fn(() => Promise.resolve(mutationResult())),
  };
}

function service(storage: StorageDouble, settings: SettingsDouble): BrandingService {
  return new BrandingService(
    settings as unknown as SettingsService,
    storage as unknown as BrandingObjectStorage,
  );
}

describe('BrandingService.deleteLogo — cross-tenant object-storage safety', () => {
  it('CRITICAL: never deletes another company\'s real logo object, even when that company\'s real URL is stored in this company\'s own setting', async () => {
    // Company B's real, genuinely-uploaded logo URL — legitimately owned
    // by company B, publicly readable (the bucket is public-read by
    // design), and discoverable by anyone who can see company B's
    // branded output.
    const companyBLogoUrl = `http://127.0.0.1:9000/asone-branding/logos/${COMPANY_B}/real-logo.png`;
    // Attack precondition: company A's `branding.logo_url` setting has
    // been poisoned with company B's URL (this is possible today because
    // the generic `PUT /companies/{id}/settings/branding.logo_url` route
    // accepts any string — that part of the vulnerability is out of this
    // file's scope; this test proves the DELETE path refuses to act on it
    // regardless of how the value got there).
    const storage = fakeStorage();
    const brandingService = service(storage, fakeSettings(companyBLogoUrl));

    const scope: SettingsScope = { companyId: COMPANY_A };
    const result = await brandingService.deleteLogo(scope, deleteInput());

    // The setting mutation itself still succeeds (clearing company A's OWN
    // setting is always a legitimate operation) —
    expect(result.effective.value).toBe('');
    // — but the DESTRUCTIVE storage call must never have been issued
    // against company B's object.
    expect(storage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });

  it('still deletes the object when it genuinely belongs to the acting company', async () => {
    const companyAOwnLogoUrl = `http://127.0.0.1:9000/asone-branding/logos/${COMPANY_A}/real-logo.png`;
    const storage = fakeStorage();
    const brandingService = service(storage, fakeSettings(companyAOwnLogoUrl));

    await brandingService.deleteLogo({ companyId: COMPANY_A }, deleteInput());

    expect(storage.deleteObjectBestEffort).toHaveBeenCalledTimes(1);
    expect(storage.deleteObjectBestEffort).toHaveBeenCalledWith(`logos/${COMPANY_A}/real-logo.png`);
  });

  it('never attempts a delete when there was no previous logo at all', async () => {
    const storage = fakeStorage();
    const brandingService = service(storage, fakeSettings(''));

    await brandingService.deleteLogo({ companyId: COMPANY_A }, deleteInput());

    expect(storage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });

  it('never attempts a delete for a value that is not a real object-storage URL at all', async () => {
    const storage = fakeStorage();
    const brandingService = service(
      storage,
      fakeSettings('not a real object-storage url, just an arbitrary poisoned string'),
    );

    await brandingService.deleteLogo({ companyId: COMPANY_A }, deleteInput());

    expect(storage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });

  it('rejects a prefix-colliding tenant id rather than treating it as owned', async () => {
    // Company A's real id, with a single extra character appended — a
    // naive `startsWith`-based ownership check would wrongly treat this as
    // "close enough"; the real check must not.
    const collidingCompanyId = `${COMPANY_A}x`;
    const collidingUrl = `http://127.0.0.1:9000/asone-branding/logos/${collidingCompanyId}/real-logo.png`;
    const storage = fakeStorage();
    const brandingService = service(storage, fakeSettings(collidingUrl));

    await brandingService.deleteLogo({ companyId: COMPANY_A }, deleteInput());

    expect(storage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });
});
