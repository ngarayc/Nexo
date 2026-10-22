import { Injectable, OnModuleDestroy, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Sessions } from '../../../access/public.js';
import { RuntimeInstance } from '../../../../platform/runtime/runtime.module.js';
import { RealtimeAvailability } from '../../application/availability.js';
import { SseConnection } from './sse-connection.js';

const unavailable = (code: string, message: string) => new HttpException({ code, message }, 503);

@Injectable()
export class StreamConnections implements OnModuleDestroy {
  private readonly all = new Set<SseConnection>();
  private readonly sessions = new Map<string, Set<SseConnection>>();
  private readonly heartbeat;
  private readonly removeDegraded;

  constructor(
    private readonly access: Sessions,
    private readonly instance: RuntimeInstance,
    private readonly availability: RealtimeAvailability,
  ) {
    access.store.on('revoked', this.revoked);
    this.removeDegraded = availability.onDegraded(() => this.closeAll());
    this.heartbeat = setInterval(() => {
      if (availability.healthy) this.broadcast(this.control('stream.heartbeat'));
    }, 15000);
    this.heartbeat.unref();
  }

  open(request: Request, response: Response): void {
    const identity = this.access.require(request);
    if (!this.availability.healthy)
      throw unavailable('REALTIME_UNAVAILABLE', 'La actualización en vivo no está disponible.');
    const sid = request.sessionID;
    const own = this.sessions.get(sid) ?? new Set<SseConnection>();
    if (this.all.size >= 16 || own.size >= 4)
      throw unavailable('STREAM_CAPACITY_EXCEEDED', 'Hay conexiones en vivo en curso.');
    const connection = new SseConnection(
      response,
      () => {
        if (!this.availability.healthy) return false;
        this.access.require(request);
        return true;
      },
      () => {
        this.all.delete(connection);
        own.delete(connection);
        if (!own.size) this.sessions.delete(sid);
      },
      () => Date.now(),
      () => this.control('stream.resync-required'),
    );
    this.all.add(connection);
    own.add(connection);
    this.sessions.set(sid, own);
    try {
      response.status(200);
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'private, no-store, no-transform');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
      connection.start(identity.expiresAt);
      // Alta y ready síncronos: el distribuidor no puede intercalar dominio aquí.
      connection.enqueue(this.control('stream.ready'));
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  broadcast(frame: string): void {
    for (const connection of this.all) {
      try {
        connection.enqueue(frame);
      } catch {
        connection.close();
      }
    }
  }
  closeAll(): void {
    for (const connection of this.all) connection.close();
  }
  private readonly revoked = (sid: string): void => {
    for (const connection of this.sessions.get(sid) ?? []) connection.close();
  };
  private control(type: 'stream.ready' | 'stream.heartbeat' | 'stream.resync-required'): string {
    return `event:${type}\ndata:${JSON.stringify({
      type,
      schemaVersion: 1,
      instanceId: this.instance.id,
      ...(type === 'stream.ready' ? { heartbeatMilliseconds: 15000 } : {}),
      ...(type === 'stream.resync-required' ? { reason: 'CLIENT_CAPACITY' } : {}),
    })}\n\n`;
  }
  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    this.removeDegraded();
    this.access.store.off('revoked', this.revoked);
    this.closeAll();
  }
}
