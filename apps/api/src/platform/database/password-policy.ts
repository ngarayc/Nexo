import { argon2id } from 'argon2';

export const passwordHashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  version: 0x13,
} as const;
