import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { WriteDatabase } from '../../platform/database/write-database.js';
import { QueueConnection } from '../../platform/queue/connection.js';
import { AdmissionStore } from './adapters/postgres/admission-store.js';
import { ReceiptReader } from './adapters/postgres/receipt-reader.js';
import { Ingest } from './application/ingest.js';
import { IngestionIngress } from './adapters/http/ingress.js';
import { IngestionController } from './adapters/http/ingestion-controller.js';
import { ProcessItem } from './adapters/postgres/process-item.js';
import { IngestionWorker } from './adapters/queue/ingestion-worker.js';
import { RecoverItem } from './adapters/postgres/recover-item.js';
import { ReconcileIngestion } from './application/reconcile.js';
import { IngestionReconciler } from './adapters/queue/ingestion-reconciler.js';
import { RuntimeModule } from '../../platform/runtime/runtime.module.js';

@Module({
  imports: [DatabaseModule, RuntimeModule],
  controllers: [IngestionController],
  providers: [
    WriteDatabase,
    QueueConnection,
    IngestionIngress,
    IngestionWorker,
    IngestionReconciler,
    {
      provide: RecoverItem,
      inject: [WriteDatabase, QueueConnection],
      useFactory: (write: WriteDatabase, queue: QueueConnection) =>
        new RecoverItem(write.pool, queue.boss),
    },
    {
      provide: ReconcileIngestion,
      inject: [RecoverItem],
      useFactory: (recovery: RecoverItem) => new ReconcileIngestion(recovery),
    },
    {
      provide: ProcessItem,
      inject: [WriteDatabase, QueueConnection],
      useFactory: (write: WriteDatabase, queue: QueueConnection) =>
        new ProcessItem(write.pool, queue.boss),
    },
    {
      provide: AdmissionStore,
      inject: [WriteDatabase, DatabaseService, QueueConnection],
      useFactory: (write: WriteDatabase, read: DatabaseService, queue: QueueConnection) =>
        new AdmissionStore(write.pool, read.pool, queue.boss, read.querySlots),
    },
    {
      provide: ReceiptReader,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new ReceiptReader(database.pool, database.querySlots),
    },
    {
      provide: Ingest,
      inject: [AdmissionStore, ReceiptReader],
      useFactory: (admission: AdmissionStore, receipts: ReceiptReader) =>
        new Ingest(admission, receipts),
    },
  ],
  exports: [IngestionIngress],
})
export class IngestionModule {}
