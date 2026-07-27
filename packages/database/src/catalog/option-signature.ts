import { createHash } from 'node:crypto';

import { CatalogDomainError } from './errors.js';

export interface OptionValuePair {
  readonly optionDefinitionId: string;
  readonly optionValueId: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function generateOptionSignature(pairs: readonly OptionValuePair[]): string {
  const canonicalPairs = pairs.map(({ optionDefinitionId, optionValueId }) => {
    const definition = optionDefinitionId.toLowerCase();
    const value = optionValueId.toLowerCase();
    if (!uuidPattern.test(definition) || !uuidPattern.test(value)) {
      throw new CatalogDomainError(
        'invalid_option_combination',
        'Option signatures require valid definition and value UUIDs.',
      );
    }
    return { definition, value };
  });

  canonicalPairs.sort((left, right) =>
    left.definition < right.definition ? -1 : left.definition > right.definition ? 1 : 0,
  );
  for (let index = 1; index < canonicalPairs.length; index += 1) {
    if (canonicalPairs[index - 1]?.definition === canonicalPairs[index]?.definition) {
      throw new CatalogDomainError(
        'invalid_option_combination',
        'An option combination cannot contain multiple values for one definition.',
      );
    }
  }

  const canonical = canonicalPairs
    .map(({ definition, value }) => `${definition}=${value}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
