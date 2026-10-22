import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { RuntimeModule, RuntimeInstance } from '../../platform/runtime/runtime.module.js';
import { DomainQueries } from './application/queries.js';
import { PostgresReadModel } from './adapters/postgres/read-model.js';
import { QueryController } from './adapters/http/query-controller.js';

@Module({
  imports: [DatabaseModule, RuntimeModule],
  controllers: [QueryController],
  providers: [
    {
      provide: DomainQueries,
      inject: [DatabaseService, RuntimeInstance],
      useFactory: (database: DatabaseService, instance: RuntimeInstance) =>
        new DomainQueries(new PostgresReadModel(database.pool), instance.id),
    },
  ],
})
export class QueriesModule {}
