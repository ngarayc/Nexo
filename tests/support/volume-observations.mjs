import { readFile as readVolumeText } from 'node:fs/promises';
import { performance as volumeClock } from 'node:perf_hooks';

export function latencySummary(samples) {
  if (
    !Array.isArray(samples) ||
    !samples.length ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error('Muestras de latencia inválidas.');
  const ordered = [...samples].sort((a, b) => a - b);
  const rounded = (value) => Math.round(value * 1000) / 1000;
  const rank = (percentile) => rounded(ordered[Math.ceil(ordered.length * percentile) - 1]);
  return {
    samples: ordered.length,
    minimum: rounded(ordered[0]),
    p50: rank(0.5),
    p95: rank(0.95),
    p99: rank(0.99),
    maximum: rounded(ordered.at(-1)),
  };
}

export function createVolumeObservations({
  now = () => volumeClock.now(),
  readText = (path) => readVolumeText(path, 'utf8'),
} = {}) {
  const posts = [],
    confirmations = [];
  const responses = {
    http200: 0,
    pending503: 0,
    receiptPolls: 0,
    unexpected: 0,
    requestFailures: 0,
  };
  const memory = {
    samples: 0,
    apiProcessPeakRssBytes: 0,
    containerPeakUsageBytes: 0,
    cgroupVersion: null,
    containerIncludesLoadClient: true,
  };
  let identityChecked = false,
    nextMemory = 0;
  const elapsed = (start) => {
    const value = now() - start;
    if (!Number.isFinite(value) || value < 0) throw new Error('Reloj de medición inválido.');
    return value;
  };
  const bytes = (value) => {
    if (!/^\d+$/.test(value.trim())) throw new Error('Contador de memoria inválido.');
    const result = Number(value.trim());
    if (!Number.isSafeInteger(result) || result <= 0)
      throw new Error('Contador de memoria inválido.');
    return result;
  };
  return {
    start: () => now(),
    post(status, start) {
      posts.push(elapsed(start));
      if (status === 200) responses.http200++;
      else if (status === 503) responses.pending503++;
      else responses.unexpected++;
    },
    confirmed(start) {
      confirmations.push(elapsed(start));
    },
    poll() {
      responses.receiptPolls++;
    },
    failedRequest() {
      responses.requestFailures++;
    },
    async sampleMemory(force = false) {
      if (!force && now() < nextMemory) return;
      try {
        if (!identityChecked) {
          const command = (await readText('/proc/1/cmdline')).split('\0');
          if (!/(?:^|\/)node$/.test(command[0]) || !command.includes('/app/apps/api/dist/main.js'))
            throw new Error('El proceso observado no es el servidor API.');
          const membership = await readText('/proc/1/cgroup');
          if (!/^(?:0::\/|\d+:[^:]*\bmemory\b[^:]*:\/)$/m.test(membership))
            throw new Error('La medición requiere el cgroup propio del contenedor.');
          identityChecked = true;
        }
        const status = await readText('/proc/1/status');
        const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
        if (!match) throw new Error('RSS del servidor no disponible.');
        const rss = bytes(String(Number(match[1]) * 1024));
        let usage;
        if (memory.cgroupVersion === null) {
          try {
            usage = await readText('/sys/fs/cgroup/memory.current');
            memory.cgroupVersion = 2;
          } catch {
            usage = await readText('/sys/fs/cgroup/memory/memory.usage_in_bytes');
            memory.cgroupVersion = 1;
          }
        } else
          usage = await readText(
            memory.cgroupVersion === 2
              ? '/sys/fs/cgroup/memory.current'
              : '/sys/fs/cgroup/memory/memory.usage_in_bytes',
          );
        const usageBytes = bytes(usage);
        memory.samples++;
        memory.apiProcessPeakRssBytes = Math.max(memory.apiProcessPeakRssBytes, rss);
        memory.containerPeakUsageBytes = Math.max(memory.containerPeakUsageBytes, usageBytes);
        nextMemory = now() + 1000;
      } catch {
        throw new Error('No se pudo medir memoria del servidor/contenedor API.');
      }
    },
    summary(submissions) {
      if (
        !Number.isSafeInteger(submissions) ||
        submissions <= 0 ||
        posts.length !== submissions ||
        confirmations.length !== submissions ||
        responses.http200 + responses.pending503 !== submissions ||
        responses.unexpected !== 0 ||
        responses.requestFailures !== 0 ||
        memory.samples < 2 ||
        responses.receiptPolls < responses.pending503
      )
        throw new Error('La observación de carga quedó incompleta o con fallos.');
      return {
        clock: 'client-monotonic',
        latencyUnit: 'milliseconds',
        percentileMethod: 'nearest-rank',
        post: latencySummary(posts),
        receiptCompletion: latencySummary(confirmations),
        responses: { ...responses },
        memory: {
          method: 'sampled-proc-and-cgroup',
          intervalMilliseconds: 1000,
          unit: 'bytes',
          ...memory,
        },
      };
    },
  };
}
