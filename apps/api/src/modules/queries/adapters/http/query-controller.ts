import { Controller, Get, Post, Req, Param, HttpCode } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { RequireAccess } from '../../../../platform/http/access-policy.js';
import { readJsonBody, JsonBodyError } from '../../../../platform/http/read-body.js';
import { ProblemDetailsError } from '../../../../platform/http/problem.js';
import { DatabaseService } from '../../../../platform/database/database.service.js';
import { DatabaseCapacityError } from '../../../../platform/database/slots.js';
import {
  DomainQueries,
  InvalidQuery,
  readFleetQuery,
  readAlertsQuery,
  readVehicleId,
  readVehicleQueryBody,
} from '../../application/queries.js';

const problems = {
  INVALID_QUERY: [400, 'Solicitud incorrecta', 'Revisa los parámetros de la consulta.'],
  MALFORMED_JSON: [400, 'JSON incorrecto', 'El cuerpo no contiene un documento JSON UTF-8 válido.'],
  BODY_TOO_LARGE: [413, 'Contenido demasiado grande', 'El cuerpo supera 2 MiB.'],
  UNSUPPORTED_MEDIA_TYPE: [
    415,
    'Formato no admitido',
    'Usa application/json UTF-8 sin compresión.',
  ],
  REQUEST_TIMEOUT: [408, 'Tiempo de espera agotado', 'El cuerpo no se recibió dentro del plazo.'],
  QUERY_CAPACITY_EXCEEDED: [503, 'Servicio ocupado', 'Hay consultas en curso. Inténtalo de nuevo.'],
} as const;

function readAlertFilter(request: Request): string | undefined {
  const separator = request.originalUrl.indexOf('?');
  const source = separator === -1 ? '' : request.originalUrl.slice(separator + 1);
  try {
    decodeURIComponent(source);
  } catch {
    throw new InvalidQuery();
  }
  const query = new URLSearchParams(source);
  if (query.getAll('vehicleId').length > 1) throw new InvalidQuery();
  return readAlertsQuery(Object.fromEntries(query));
}

@Controller()
@RequireAccess('session-read')
export class QueryController {
  constructor(
    private readonly queries: DomainQueries,
    private readonly database: DatabaseService,
  ) {}
  @Get('vehicles')
  fleet(@Req() request: Request) {
    return this.run(request, () => this.queries.fleet(readFleetQuery(request.query)));
  }
  @Get('vehicles/:vehicleId/events')
  history(@Param('vehicleId') vehicleId: string, @Req() request: Request) {
    return this.run(request, () => this.queries.history(readVehicleId(vehicleId)));
  }
  @Get('alerts')
  alerts(@Req() request: Request) {
    return this.run(request, () => this.queries.alerts(readAlertFilter(request)));
  }
  @Get('snapshot')
  snapshot(@Req() request: Request) {
    return this.run(request, () => this.queries.snapshot());
  }
  @Post('queries/vehicle-events')
  @HttpCode(200)
  @RequireAccess('session-query')
  queryHistory(@Req() request: Request) {
    return this.run(request, async () =>
      this.queries.history(await this.readVehicleQuery(request)),
    );
  }
  @Post('queries/alerts')
  @HttpCode(200)
  @RequireAccess('session-query')
  queryAlerts(@Req() request: Request) {
    return this.run(request, async () => this.queries.alerts(await this.readVehicleQuery(request)));
  }
  private async readVehicleQuery(request: Request): Promise<string> {
    const source = await readJsonBody(request, 2 * 1024 * 1024, Date.now() + 15000);
    let body: unknown;
    try {
      body = JSON.parse(source) as unknown;
    } catch {
      throw new JsonBodyError('MALFORMED_JSON');
    }
    return readVehicleQueryBody(body);
  }
  private async run<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    try {
      return await this.database.querySlots.run(operation);
    } catch (error) {
      request.resume();
      const code =
        error instanceof JsonBodyError
          ? error.code
          : error instanceof InvalidQuery
            ? 'INVALID_QUERY'
            : error instanceof DatabaseCapacityError
              ? 'QUERY_CAPACITY_EXCEEDED'
              : undefined;
      if (!code) throw error;
      const [status, title, detail] = problems[code];
      throw new ProblemDetailsError({
        type: 'about:blank',
        status,
        title,
        detail,
        code,
        requestId: randomUUID(),
      });
    }
  }
}
