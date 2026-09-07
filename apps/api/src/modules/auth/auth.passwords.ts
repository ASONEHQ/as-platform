import argon2 from 'argon2';

const options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// TASK 14.0 — the real, production-facing strength policy for any password
// an admin sets while activating a real staff account (`AdministrationService
// .updateMembership`). Deliberately a plain string return (`null` = valid),
// never a throw, so callers stay free to map it into whatever HTTP error
// shape they already use — mirrors `apps/api/src/development/bootstrap-
// owner.service.ts`'s own `validateBootstrapPassword` rule set (length,
// case, digit, symbol, no bare placeholder), reimplemented here rather than
// imported from it: `development/` is dev/QA-only tooling excluded from
// the production build, and a real admin-facing password check must not
// depend on it.
const placeholderPasswords = ['password', 'changeme', 'change_me', 'replace_me', 'example'];
export function validatePasswordStrength(password: string): string | null {
  const normalized = password.trim().toLowerCase();
  if (
    password.length < 12 ||
    !/[a-z]/u.test(password) ||
    !/[A-Z]/u.test(password) ||
    !/[0-9]/u.test(password) ||
    !/[^A-Za-z0-9]/u.test(password) ||
    placeholderPasswords.some((placeholder) => normalized.includes(placeholder))
  )
    return 'The password must be at least 12 characters and include uppercase, lowercase, a digit, and a symbol.';
  return null;
}
