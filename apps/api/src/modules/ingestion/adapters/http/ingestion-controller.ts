import { Controller, Post, Get, HttpCode, Req, Param } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { RequireAccess } from '../../../../platform/http/access-policy.js';
import { ProblemDetailsError } from '../../../../platform/http/problem.js';
import { Ingest, IngestionCapacityError, IngestionIdConflict } from '../../application/ingest.js';
import { ReceiptReader } from '../postgres/receipt-reader.js';
import { AdmissionError, readBatch, readIdempotencyKey } from '../../domain/batch.js';
import { IngestionIngress } from './ingress.js';
import { readIngestionBody } from './read-body.js';
import { ingestionProblem } from './problem.js';

@Controller()
export class IngestionController {
  constructor(
    private readonly ingress: IngestionIngress,
    private readonly ingest: Ingest,
    private readonly receipts: ReceiptReader,
  ) {}

  @Post('events/batch')
  @HttpCode(200)
  @RequireAccess('producer')
  async batch(@Req() request: Request) {
    const context = this.ingress.context(request);
    let ingestionId: string;
    try {
      ingestionId = readIdempotencyKey(request.get('Idempotency-Key')) ?? randomUUID();
    } catch (error) {
      if (error instanceof AdmissionError) throw ingestionProblem(error.code, context.requestId);
      throw error;
    }
    const source = await readIngestionBody(
      request,
      this.ingress.limits.bodyBytes,
      context.deadline - 8000,
      context.requestId,
    );
    let admissionStarted = false;
    try {
      const batch = readBatch(source, this.ingress.limits);
      admissionStarted = true;
      const result = await this.ingress.run(request, () =>
        this.ingest.execute(ingestionId, batch, context.deadline, context.signal),
      );
      if (result.state === 'unavailable')
        throw ingestionProblem('INGESTION_STATUS_UNAVAILABLE', context.requestId, {
          ingestionId: result.ingestionId,
          admission: result.admission,
        });
      if (result.state === 'pending' || result.state === 'failed')
        throw ingestionProblem(
          result.state === 'pending' ? 'INGESTION_RESULT_PENDING' : 'INGESTION_PROCESSING_FAILED',
          context.requestId,
          { ...result.receipt, admission: 'admitted', resultsAvailable: true },
        );
      return { ...result.receipt, requestId: context.requestId };
    } catch (error) {
      if (error instanceof AdmissionError) throw ingestionProblem(error.code, context.requestId);
      if (error instanceof IngestionIdConflict)
        throw ingestionProblem('INGESTION_ID_CONFLICT', context.requestId);
      if (error instanceof IngestionCapacityError)
        throw ingestionProblem('INGESTION_CAPACITY_EXCEEDED', context.requestId);
      if (error instanceof ProblemDetailsError) throw error;
      throw ingestionProblem('INGESTION_STATUS_UNAVAILABLE', context.requestId, {
        ingestionId,
        admission: admissionStarted ? 'unknown' : 'not_admitted',
      });
    }
  }

  @Get('ingestions/:ingestionId')
  @RequireAccess('producer')
  producerReceipt(@Param('ingestionId') ingestionId: string, @Req() request: Request) {
    return this.readReceipt(ingestionId, this.ingress.context(request).requestId);
  }

  @Get('demo/ingestions/:ingestionId')
  @RequireAccess('demo-read')
  demoReceipt(@Param('ingestionId') ingestionId: string) {
    return this.readReceipt(ingestionId, randomUUID());
  }

  private async readReceipt(value: string, requestId: string) {
    let ingestionId: string;
    try {
      const parsed = readIdempotencyKey(value);
      if (!parsed) throw new AdmissionError('INVALID_IDEMPOTENCY_KEY');
      ingestionId = parsed;
    } catch (error) {
      if (error instanceof AdmissionError)
        throw ingestionProblem('INVALID_INGESTION_ID', requestId);
      throw error;
    }
    try {
      const receipt = await this.receipts.find(ingestionId);
      if (!receipt) throw ingestionProblem('INGESTION_NOT_FOUND', requestId);
      return { ...receipt, requestId };
    } catch (error) {
      if (error instanceof ProblemDetailsError) throw error;
      throw ingestionProblem('INGESTION_STATUS_UNAVAILABLE', requestId, {
        ingestionId,
        admission: 'unknown',
      });
    }
  }
}
