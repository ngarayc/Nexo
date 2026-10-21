import { hash, verify, needsRehash } from 'argon2';
import type { PasswordVerifier } from '../application/authenticate.js';
import { passwordHashOptions } from '../../../platform/database/password-policy.js';

export class ArgonPasswordVerifier implements PasswordVerifier {
  private constructor(private readonly dummyHash: string) {}

  static async create(): Promise<ArgonPasswordVerifier> {
    return new ArgonPasswordVerifier(await hash('nexo-unknown-account', passwordHashOptions));
  }

  async verify(stored: string | undefined, password: string): Promise<boolean> {
    const chosen = stored ?? this.dummyHash;
    if (!chosen.startsWith('$argon2id$') || needsRehash(chosen, passwordHashOptions)) {
      throw new Error('Hash de cuenta incompatible.');
    }
    return verify(chosen, password);
  }
}
