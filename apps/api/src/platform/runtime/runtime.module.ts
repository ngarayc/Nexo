import { randomUUID } from 'node:crypto';
import { Injectable, Module } from '@nestjs/common';

@Injectable()
export class RuntimeInstance {
  private identifier = randomUUID();
  readonly schemaVersion = 1 as const;
  get id(): string {
    return this.identifier;
  }
  renew(): void {
    this.identifier = randomUUID();
  }
}

@Injectable()
export class RuntimeHealth {
  private readonly checks = new Set<() => boolean>();
  register(check: () => boolean): () => void {
    this.checks.add(check);
    return () => {
      this.checks.delete(check);
    };
  }
  get healthy(): boolean {
    try {
      return [...this.checks].every((check) => check());
    } catch {
      return false;
    }
  }
}

@Injectable()
export class CommittedChanges {
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

@Module({
  providers: [RuntimeInstance, RuntimeHealth, CommittedChanges],
  exports: [RuntimeInstance, RuntimeHealth, CommittedChanges],
})
export class RuntimeModule {}
