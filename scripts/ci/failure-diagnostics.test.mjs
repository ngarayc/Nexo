import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pressureFailureStage,
  browserFailureStage,
  browserFailureLines,
} from './failure-diagnostics.mjs';

function failure(actual, expected = 'realtime-case-ok') {
  try {
    assert.equal(actual, expected);
  } catch (cause) {
    return Object.assign(new Error('test failed', { cause }), {
      code: 'ERR_TEST_FAILURE',
      failureType: 'testCodeFailure',
    });
  }
  throw new Error('El fixture debe producir una aserción fallida.');
}

test('diagnóstico de navegador limita la salida a líneas del archivo público conocido', () => {
  const report = {
    suites: [
      {
        specs: [
          {
            tests: [
              {
                results: [
                  {
                    errors: [
                      {
                        message: 'synthetic-private-marker',
                        location: {
                          file: '/private/location/tests/system/presentation.spec.mjs',
                          line: 42,
                        },
                      },
                      { location: { file: 'presentation.spec.mjs', line: 15 } },
                      { location: { file: 'presentation.spec.mjs', line: 42 } },
                      { location: { file: 'private.spec.mjs', line: 7 } },
                      { location: { file: 'presentation.spec.mjs', line: 'secret' } },
                      { location: { file: 'presentation.spec.mjs', line: 0 } },
                      { location: { file: 'presentation.spec.mjs', line: 20001 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(browserFailureLines(report, 'presentation.spec.mjs'), [15, 42]);
  assert.deepEqual(browserFailureLines(report, '../private.spec.mjs'), []);
});
test('extrae etapa cerrada desde la causa de aserción real de Node', () => {
  for (const stage of [
    'connections',
    'released-capacity',
    'fast-0',
    'fast-8',
    'fast-120',
    'ingest-0',
    'ingest-120',
  ])
    assert.equal(pressureFailureStage(failure('realtime-pressure-failed:' + stage)), stage);
});
test('nunca propaga marcadores sensibles, mensajes o etapas no admitidas', () => {
  for (const actual of [
    'synthetic-private-marker',
    'realtime-pressure-failed:fast-8\nsynthetic-private-marker',
    'realtime-pressure-failed:fast-7',
    'realtime-pressure-failed:fast-128',
    'realtime-pressure-failed:unknown',
  ])
    assert.equal(pressureFailureStage(failure(actual)), undefined);
  assert.equal(pressureFailureStage(new Error('synthetic-private-marker')), undefined);
  assert.equal(
    pressureFailureStage(failure('realtime-pressure-failed:fast-8', 'other assertion')),
    undefined,
  );
});
test('una causa cíclica o ausente termina sin diagnóstico inventado', () => {
  const error = new Error('synthetic');
  error.cause = error;
  assert.equal(pressureFailureStage(error), undefined);
  assert.equal(pressureFailureStage(null), undefined);
});

test('clasifica ambigüedad del reporte de navegador sin propagar datos del error', () => {
  const report = {
    suites: [
      {
        suites: [
          {
            specs: [
              {
                tests: [
                  {
                    results: [
                      {
                        errors: [
                          { message: 'Error: strict mode violation: synthetic-private-marker' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(browserFailureStage(report), 'locator-ambiguity');
  assert.equal(
    browserFailureStage({ errors: [{ message: 'synthetic-private-marker' }] }),
    undefined,
  );
  assert.equal(
    browserFailureStage({ errors: [{ message: 'locator-ambiguity: synthetic-private-marker' }] }),
    undefined,
  );
});
test('diagnóstico de navegador admite reporte ausente o cíclico sin inventar fallo específico', () => {
  const report = { suites: [] };
  report.suites.push(report);
  assert.equal(browserFailureStage(report), undefined);
  assert.equal(browserFailureStage(null), undefined);
});
