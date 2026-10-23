import type { Credentials } from '../domain/credentials.js';

export interface UserAccount {
  readonly id: string;
  readonly username: 'demo' | 'Demo';
  readonly passwordHash: string;
}
export interface UserReader {
  findDemo(): Promise<UserAccount | undefined>;
}
export interface PasswordVerifier {
  verify(hash: string | undefined, password: string): Promise<boolean>;
}

export class HashCapacityError extends Error {}

export class Authenticate {
  private active = 0;

  constructor(
    private readonly users: UserReader,
    private readonly passwords: PasswordVerifier,
    private readonly enabled: boolean,
    private readonly maximum = 2,
  ) {}

  async execute(
    credentials: Credentials,
  ): Promise<{ id: string; username: 'demo' | 'Demo' } | undefined> {
    if (!this.enabled) return;
    if (this.active >= this.maximum) throw new HashCapacityError();
    this.active += 1;
    try {
      const account = await this.users.findDemo();
      const known = account !== undefined && credentials.username === account.username;
      const matches = await this.passwords.verify(
        known ? account.passwordHash : undefined,
        credentials.password,
      );
      if (known && matches) return { id: account.id, username: account.username };
      return;
    } finally {
      this.active -= 1;
    }
  }
}
