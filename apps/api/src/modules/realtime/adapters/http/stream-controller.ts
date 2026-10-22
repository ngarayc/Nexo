import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequireAccess } from '../../../../platform/http/access-policy.js';
import { StreamConnections } from './stream-connections.js';

@Controller('stream')
export class StreamController {
  constructor(private readonly connections: StreamConnections) {}
  @Get()
  @RequireAccess('session-stream')
  open(@Req() request: Request, @Res() response: Response): void {
    this.connections.open(request, response);
  }
}
