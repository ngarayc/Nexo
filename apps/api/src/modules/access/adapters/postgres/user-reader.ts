import { eq } from 'drizzle-orm';
import type { UserReader, UserAccount } from '../../application/authenticate.js';
import type { DatabaseService } from '../../../../platform/database/database.service.js';
import { users } from '../../../../platform/database/schema.js';

export class PostgresUserReader implements UserReader {
  constructor(private readonly database: DatabaseService) {}

  async findDemo(): Promise<UserAccount | undefined> {
    const records = await this.database.querySlots.run(() =>
      this.database.db.select().from(users).where(eq(users.username, 'demo')).limit(1),
    );
    const account = records[0];
    if (!account || account.username !== 'demo') throw new Error('Cuenta no disponible.');
    return { id: account.id, username: account.username, passwordHash: account.passwordHash };
  }
}
