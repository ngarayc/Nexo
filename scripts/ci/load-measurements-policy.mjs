import assert from 'node:assert/strict';

const exact = (value, keys) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};
const positive = (value) => Number.isSafeInteger(value) && value > 0;

export function validateLoadMeasurements(value, submissions) {
  assert.ok(positive(submissions));
  exact(value, [
    'clock',
    'latencyUnit',
    'percentileMethod',
    'post',
    'receiptCompletion',
    'responses',
    'memory',
  ]);
  assert.equal(value.clock, 'client-monotonic');
  assert.equal(value.latencyUnit, 'milliseconds');
  assert.equal(value.percentileMethod, 'nearest-rank');
  for (const name of ['post', 'receiptCompletion']) {
    const latency = value[name];
    exact(latency, ['samples', 'minimum', 'p50', 'p95', 'p99', 'maximum']);
    assert.equal(latency.samples, submissions);
    const ordered = ['minimum', 'p50', 'p95', 'p99', 'maximum'].map((key) => latency[key]);
    assert.ok(
      ordered.every(
        (number, index) =>
          Number.isFinite(number) && number >= 0 && (index === 0 || number >= ordered[index - 1]),
      ),
    );
  }
  for (const key of ['minimum', 'p50', 'p95', 'p99', 'maximum'])
    assert.ok(value.receiptCompletion[key] >= value.post[key]);
  exact(value.responses, [
    'http200',
    'pending503',
    'receiptPolls',
    'unexpected',
    'requestFailures',
  ]);
  assert.ok(
    Object.values(value.responses).every((number) => Number.isSafeInteger(number) && number >= 0),
  );
  assert.equal(value.responses.http200 + value.responses.pending503, submissions);
  assert.ok(value.responses.receiptPolls >= value.responses.pending503);
  assert.equal(value.responses.unexpected, 0);
  assert.equal(value.responses.requestFailures, 0);
  const memory = value.memory;
  exact(memory, [
    'method',
    'intervalMilliseconds',
    'unit',
    'samples',
    'apiProcessPeakRssBytes',
    'containerPeakUsageBytes',
    'cgroupVersion',
    'containerIncludesLoadClient',
  ]);
  assert.equal(memory.method, 'sampled-proc-and-cgroup');
  assert.equal(memory.intervalMilliseconds, 1000);
  assert.equal(memory.unit, 'bytes');
  assert.ok(Number.isSafeInteger(memory.samples) && memory.samples >= 2);
  assert.ok(positive(memory.apiProcessPeakRssBytes) && positive(memory.containerPeakUsageBytes));
  assert.ok([1, 2].includes(memory.cgroupVersion));
  assert.equal(memory.containerIncludesLoadClient, true);
  return value;
}
