import { randomUUID } from 'node:crypto';
import { Injectable, Module } from '@nestjs/common';

@Injectable()
export class RuntimeInstance {
  readonly id = randomUUID();
  readonly schemaVersion = 1 as const;
}
@Module({ providers: [RuntimeInstance], exports: [RuntimeInstance] })
export class RuntimeModule {}
