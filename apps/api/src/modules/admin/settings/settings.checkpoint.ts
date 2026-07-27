import { createHash } from 'node:crypto';

import { SETTINGS_CATALOG_VERSION } from './settings.catalog.js';
import type { EffectiveSetting } from './settings.types.js';

export function canonicalSettingsSerialization(settings: readonly EffectiveSetting[]): string {
  const entries = [...settings]
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map((setting) => [
      setting.key,
      setting.type,
      setting.source,
      setting.version.toString(),
      setting.value,
    ]);
  return JSON.stringify([SETTINGS_CATALOG_VERSION, ...entries]);
}

export function settingsCheckpoint(settings: readonly EffectiveSetting[]): string {
  const digest = createHash('sha256')
    .update(canonicalSettingsSerialization(settings), 'utf8')
    .digest('hex');
  return `settings:${digest}`;
}

export function settingsCheckpointEtag(checkpoint: string): string {
  return `"${checkpoint}"`;
}
