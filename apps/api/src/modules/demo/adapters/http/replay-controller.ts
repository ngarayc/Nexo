import { randomUUID } from 'node:crypto';
import { Controller, Get, Post, HttpCode, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequireAccess } from '../../../../platform/http/access-policy.js';
import { readJsonBody, JsonBodyError } from '../../../../platform/http/read-body.js';
import { ProblemDetailsError } from '../../../../platform/http/problem.js';
import { DatabaseCapacityError } from '../../../../platform/database/slots.js';
import { DemoRuntime } from '../../demo-runtime.js';
import {
  ReplayAdmissionNotApplied,
  ReplayAdmissionUnknown,
} from '../../application/admit-command.js';
import { ReplayControlCapacity } from '../../application/command-receipts.js';
import { ReplayPreconditionsFailed } from '../../application/replay-coordinator.js';
import type { ReplayRun } from '../../application/journal.js';
import type { ReplayReport } from '../../application/verification.js';
import { ReplayCapacity, ReplayConflict, ReplayInputError } from '../../domain/replay.js';
import { readReplayQuery } from './replay-query.js';

function runView(run: ReplayRun) {
  return {
    runId: run.runId,
    scenarioId: run.scenarioId,
    previousRunId: run.previousRunId,
    instanceId: run.instanceId,
    stage: run.stage,
    state: run.state,
    intervalMs: run.intervalMs,
    nextLine: run.nextLine,
    revision: run.revision,
    verification: run.verification,
    closeCode: run.closeCode,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
function reportView(report: ReplayReport): ReplayReport {
  return {
    ...report,
    externalEvidence: {
      twoRenderedClients: report.externalEvidence.twoRenderedClients,
      pauseResume: report.externalEvidence.pauseResume,
      ci: report.externalEvidence.ci,
    },
  };
}
const problem = (
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
) =>
  new ProblemDetailsError({
    type: 'about:blank',
    status,
    title: 'Control del reproductor',
    detail,
    code,
    requestId: randomUUID(),
    ...extra,
  });

@Controller('demo/replay')
@RequireAccess('demo-read')
export class ReplayController {
  constructor(private readonly runtime: DemoRuntime) {}
  @Get()
  async read(@Req() request: Request) {
    return this.run(request, async () => {
      const query = readReplayQuery(request.query);
      if (query.view === 'current') return this.runtime.view();
      if (query.view === 'command') {
        const receipt = await this.runtime.receipt(query.commandId, query.instanceId);
        if (!receipt)
          throw problem(
            404,
            'COMMAND_RECEIPT_UNAVAILABLE',
            'No se conserva este recibo. Esto no demuestra que la orden no se admitiera.',
          );
        return receipt;
      }
      if (query.view === 'history') {
        const page = await this.runtime.history(query.limit, query.cursor);
        return { items: page.items.map(runView), nextCursor: page.nextCursor };
      }
      const snapshot = await this.runtime.detail(query.runId);
      if (!snapshot) throw problem(404, 'REPLAY_NOT_FOUND', 'No se conserva esta ejecución.');
      const root =
        snapshot.run.runId === snapshot.run.scenarioId
          ? snapshot
          : await this.runtime.detail(snapshot.run.scenarioId);
      if (!root) throw new ReplayAdmissionUnknown();
      const inspection = await this.runtime.inspect(query.runId);
      return {
        run: runView(snapshot.run),
        progress: snapshot.progress,
        scenario: {
          scenarioId: root.run.runId,
          verification: root.run.scenarioVerification,
          closedAt: root.run.scenarioClosedAt,
          report:
            root.run.scenarioDocument === null
              ? null
              : reportView(JSON.parse(root.run.scenarioDocument) as ReplayReport),
        },
        attempts: snapshot.attempts.map(({ diagnosticDocument, ...attempt }) => ({
          ...attempt,
          diagnostic:
            diagnosticDocument === null ? null : (JSON.parse(diagnosticDocument) as unknown),
        })),
        inspection: { ...inspection, report: reportView(inspection.report) },
      };
    });
  }
  @Post('commands')
  @HttpCode(202)
  @RequireAccess('demo-write')
  async command(@Req() request: Request) {
    return this.run(request, async () => {
      const source = await readJsonBody(request, 4096, Date.now() + 15000);
      let value: unknown;
      try {
        value = JSON.parse(source) as unknown;
      } catch {
        throw new JsonBodyError('MALFORMED_JSON');
      }
      return this.runtime.command(value);
    });
  }
  private async run<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      request.resume();
      if (error instanceof JsonBodyError) {
        const status =
          error.code === 'BODY_TOO_LARGE'
            ? 413
            : error.code === 'UNSUPPORTED_MEDIA_TYPE'
              ? 415
              : error.code === 'REQUEST_TIMEOUT'
                ? 408
                : 400;
        throw problem(status, error.code, 'Revisa el JSON UTF-8 y el límite de 4 KiB del comando.');
      }
      if (error instanceof ReplayInputError)
        throw problem(
          400,
          'INVALID_REPLAY_REQUEST',
          'Revisa los campos, selectores e intervalo del reproductor.',
        );
      if (error instanceof ReplayConflict)
        throw problem(
          409,
          'REPLAY_CONFLICT',
          'El estado cambió. Recupera el control actual antes de una nueva orden.',
        );
      if (error instanceof ReplayPreconditionsFailed)
        throw problem(
          409,
          'PRECONDITIONS_FAILED',
          'No se cumplen las condiciones para esta reproducción.',
          { report: reportView(error.report) },
        );
      if (error instanceof ReplayAdmissionUnknown)
        throw problem(
          503,
          'REPLAY_ADMISSION_UNKNOWN',
          'No se conoce aún el resultado durable. Consulta el estado o el recibo; no repitas el envío.',
          { admission: 'unknown' },
        );
      if (error instanceof ReplayAdmissionNotApplied)
        throw problem(503, 'REPLAY_NOT_ADMITTED', 'Se confirmó que esta orden no se admitió.', {
          admission: 'not_admitted',
        });
      if (
        error instanceof ReplayCapacity ||
        error instanceof ReplayControlCapacity ||
        error instanceof DatabaseCapacityError
      )
        throw problem(
          503,
          'REPLAY_CAPACITY_EXCEEDED',
          'La capacidad del reproductor está ocupada. Conserva la intención y recupera su estado.',
        );
      throw error;
    }
  }
}
