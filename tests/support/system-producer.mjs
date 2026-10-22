import { systemApiScript } from './system-runtime.mjs';

export function produceSystemEvents(events) {
  const source = `
    import http from 'node:http';
    let stage='request', httpStatus;
    try {
      const bytes = Buffer.from(JSON.stringify({ events: ${JSON.stringify(events)} }));
      const response = await new Promise((resolve, reject) => {
        const request = http.request({ hostname: 'web', port: 8080, path: '/api/events/batch',
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { Host: 'localhost', 'Content-Type': 'application/json', 'Content-Length': bytes.length,
            'X-API-Key': process.env.INGEST_API_KEY },
        }, response => {
          stage='response'; httpStatus=response.statusCode;
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
            catch { reject(new Error()); }
          });
        });
        request.on('error', reject);
        request.end(bytes);
      });
      stage='status';
      if (response.status !== 200) throw new Error();
      const result = response.body;
      stage='completion';
      if (result.complete !== true) throw new Error();
      console.log(JSON.stringify({ accepted: result.accepted, duplicates: result.duplicates, rejected: result.rejected }));
    } catch(error) {
      const transport=['ABORT_ERR','ECONNRESET','EPIPE','ETIMEDOUT'].includes(error?.code)?error.code:undefined;
      console.log(JSON.stringify({failed:true,stage,httpStatus,transport}));
    }
  `;
  let result;
  try {
    result = JSON.parse(systemApiScript(source));
  } catch {
    throw new Error('No se completó la ingesta del productor sintético de sistema.');
  }
  if (result?.failed === true) {
    const stage = ['request', 'response', 'status', 'completion'].includes(result.stage)
      ? result.stage
      : 'unknown';
    const status =
      Number.isInteger(result.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599
        ? String(result.httpStatus)
        : 'none';
    const transport = ['ABORT_ERR', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(result.transport)
      ? result.transport
      : 'none';
    throw new Error(
      `Productor sintético no aprobado: etapa=${stage}, HTTP=${status}, transporte=${transport}.`,
    );
  }
  return result;
}
