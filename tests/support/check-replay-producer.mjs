// Adaptador contra HTTP/cola/SQL reales; aún no acredita ritmo, controles o UI.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { LoopbackReplayProducer } from '/app/apps/api/dist/modules/demo/adapters/http/replay-producer.js';
import { LoadOfficialFixture } from '/app/apps/api/dist/modules/demo/application/official-fixture.js';
import { FileOfficialSources } from '/app/apps/api/dist/modules/demo/adapters/files/official-sources.js';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';

const pool = new Pool(readDatabaseConfig(process.env, true).pool);
const producer = new LoopbackReplayProducer(3000, process.env.INGEST_API_KEY);
const signal = AbortSignal.timeout(120000);
const counts = async () =>
  (
    await pool.query(`SELECT
      (SELECT count(*)::int FROM ingestion_batches) AS receipts,
      (SELECT count(*)::int FROM telemetry_events) AS events,
      (SELECT count(*)::int FROM vehicle_latest) AS vehicles,
      (SELECT count(*)::int FROM alerts) AS alerts,
      (SELECT count(*)::int FROM outbox_messages) AS messages`)
  ).rows[0];
const cases = {
  async official() {
    const fixture = await new LoadOfficialFixture(new FileOfficialSources()).load();
    for (const stage of ['first', 'second']) {
      const observed = [];
      for (const row of fixture.rows) {
        const ingestionId = randomUUID();
        const result = await producer.send(row, ingestionId, signal);
        assert.deepEqual(result, {
          state: 'classified',
          outcome: stage === 'first' ? row.firstOutcome : row.secondOutcome,
          reasonCode: row.reason,
        });
        const stored = await pool.query(
          'SELECT input_document::text=$2 AS matches FROM ingestion_items WHERE ingestion_id=$1 AND item_index=0',
          [ingestionId, row.inputDocument],
        );
        assert.equal(stored.rows[0].matches, true, 'Se conserva el documento original.');
        observed.push(result.outcome);
      }
      assert.deepEqual(
        ['accepted', 'duplicate', 'rejected'].map(
          (outcome) => observed.filter((value) => value === outcome).length,
        ),
        stage === 'first' ? [20, 2, 2] : [0, 22, 2],
      );
      assert.deepEqual(await counts(), {
        receipts: stage === 'first' ? 24 : 48,
        events: 20,
        vehicles: 8,
        alerts: 4,
        messages: 43,
      });
    }
  },
  async lost_response() {
    const before = await counts();
    const eventId = randomUUID();
    const row = {
      eventId,
      body: JSON.stringify({
        events: [
          {
            eventId,
            vehicleId: randomUUID(),
            observedAt: '2026-01-01T00:00:00Z',
            latitude: 4,
            longitude: -74,
            speedKph: 0,
            ignitionOn: true,
          },
        ],
      }),
    };
    let requests = 0;
    const losingResponse = new LoopbackReplayProducer(
      3000,
      process.env.INGEST_API_KEY,
      async (...args) => {
        requests++;
        const response = await fetch(...args);
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        throw new Error('synthetic-response-lost-after-real-processing');
      },
    );
    const result = await losingResponse.send(row, randomUUID(), signal);
    assert.equal(result.state, 'uncertain');
    assert.equal(result.closeCode, 'TRANSPORT_UNCERTAIN');
    assert.equal(requests, 1, 'El emisor no reenvía una respuesta perdida.');
    const after = await counts();
    assert.equal(after.receipts, before.receipts + 1);
    assert.equal(after.events, before.events + 1);
    assert.equal(after.messages, before.messages + 2);
    const invalidKey = new LoopbackReplayProducer(3000, '0'.repeat(64));
    const denied = await invalidKey.send(row, randomUUID(), signal);
    assert.equal(denied.state, 'technical_failure');
    assert.equal(denied.closeCode, 'NOT_ADMITTED');
    assert.equal(denied.httpStatus, 403);
    assert.deepEqual(await counts(), after, 'La clave incorrecta no admite trabajo.');
  },
};
try {
  const scenario = process.env.NEXO_PRODUCER_CASE;
  assert.equal(Object.hasOwn(cases, scenario), true);
  await cases[scenario]();
  console.log('replay-producer-case-ok');
} finally {
  await pool.end();
}
