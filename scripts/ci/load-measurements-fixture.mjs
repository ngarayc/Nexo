export function measurementFixture() {
  const latency = { samples: 200, minimum: 1, p50: 2, p95: 4, p99: 5, maximum: 6 };
  return {
    clock: 'client-monotonic',
    latencyUnit: 'milliseconds',
    percentileMethod: 'nearest-rank',
    post: { ...latency },
    receiptCompletion: { ...latency, maximum: 7 },
    responses: { http200: 199, pending503: 1, receiptPolls: 2, unexpected: 0, requestFailures: 0 },
    memory: {
      method: 'sampled-proc-and-cgroup',
      intervalMilliseconds: 1000,
      unit: 'bytes',
      samples: 3,
      apiProcessPeakRssBytes: 2048,
      containerPeakUsageBytes: 8192,
      cgroupVersion: 2,
      containerIncludesLoadClient: true,
    },
  };
}
