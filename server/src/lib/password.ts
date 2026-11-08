import argon2 from 'argon2';
import { z } from 'zod';

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // ~19 MiB (OWASP minimum recommendation for argon2id)
  timeCost: 2,
  parallelism: 1,
} as const;

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), {
    message: 'Password must contain upper case, lower case and a number',
  });

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// A real hash of a random string, used so that logging in with an unknown e-mail
// takes about as long as a wrong password (prevents account enumeration by timing).
let dummyHash: Promise<string> | undefined;
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= argon2.hash(`dummy-${Math.random()}-${Date.now()}`, ARGON_OPTIONS);
  return dummyHash.then((hash) => verifyPassword(hash, password));
}
