import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { Authenticate } from './application/authenticate.js';
import { ArgonPasswordVerifier } from './adapters/argon-password-verifier.js';
import { PostgresUserReader } from './adapters/postgres/user-reader.js';
import { ACCESS_CONFIG, readAccessConfig } from './adapters/http/access-config.js';
import type { AccessConfig } from './adapters/http/access-config.js';
import { AccessGuard } from './adapters/http/access-guard.js';
import { RequestLimits } from './adapters/http/request-limits.js';
import { Sessions } from './adapters/http/sessions.js';
import { SessionController } from './adapters/http/session-controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [SessionController],
  providers: [
    { provide: ACCESS_CONFIG, useFactory: () => readAccessConfig(process.env) },
    {
      provide: Authenticate,
      inject: [DatabaseService, ACCESS_CONFIG],
      useFactory: async (database: DatabaseService, config: AccessConfig) =>
        new Authenticate(
          new PostgresUserReader(database),
          await ArgonPasswordVerifier.create(),
          config.demoEnabled,
        ),
    },
    Sessions,
    RequestLimits,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [Sessions],
})
export class AccessModule {}
