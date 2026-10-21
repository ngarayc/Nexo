import { Controller, Post, Get, Delete, Req, Res, HttpCode } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequireAccess } from '../../../../platform/http/access-policy.js';
import { readJson } from '../../../../platform/http/read-json.js';
import { readCredentials } from '../../domain/credentials.js';
import { Authenticate, HashCapacityError } from '../../application/authenticate.js';
import { Sessions } from './sessions.js';
import { RequestLimits } from './request-limits.js';
import { accessError } from './access-error.js';

@Controller('session')
export class SessionController {
  constructor(
    private readonly authenticate: Authenticate,
    private readonly sessions: Sessions,
    private readonly limits: RequestLimits,
  ) {}

  @Post()
  @HttpCode(200)
  @RequireAccess('login')
  async login(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const credentials = readCredentials(await readJson(request, 4096));
    if (!credentials)
      throw accessError('INVALID_CREDENTIAL_FORMAT', 400, 'Revisa el usuario y la contraseña.');
    await this.limits.consume('login', request, response);
    try {
      const user = await this.authenticate.execute(credentials);
      if (!user) throw accessError('INVALID_CREDENTIALS', 403, 'Usuario o contraseña incorrectos.');
      await this.sessions.create(request, user);
      return this.sessions.describe(request);
    } catch (error) {
      if (error instanceof HashCapacityError)
        throw accessError(
          'HASH_CAPACITY_REACHED',
          503,
          'Hay solicitudes de acceso en curso. Inténtalo de nuevo.',
        );
      throw error;
    }
  }

  @Get()
  @RequireAccess('session-read')
  current(@Req() request: Request) {
    return this.sessions.describe(request);
  }

  @Delete()
  @HttpCode(204)
  @RequireAccess('session-write')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logout(request, response);
  }
}
