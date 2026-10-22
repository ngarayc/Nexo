import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pressureFailureStage } from './failure-diagnostics.mjs';

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
