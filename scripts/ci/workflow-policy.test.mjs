import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateWorkflows } from './workflow-policy.mjs';

const files = [
  '.github/workflows/ci.yml',
  '.github/workflows/main-review.yml',
  '.github/actions/setup-project/action.yml',
];
const documents = () => files.map((file) => parse(readFileSync(file, 'utf8')));

test('los workflows reales conservan el protocolo de integración acordado', () =>
  validateWorkflows(...documents()));

test('bloquea omisión de job, agregado condicional y continue-on-error', () => {
  for (const mutate of [
    (ci) => {
      delete ci.jobs.unit;
    },
    (ci) => {
      ci.jobs.unit.if = false;
    },
    (ci) => {
      ci.jobs['ci-required'].if = false;
    },
    (ci) => {
      ci.jobs.integration['continue-on-error'] = true;
    },
  ]) {
    const docs = documents();
    mutate(docs[0]);
    assert.throws(() => validateWorkflows(...docs));
  }
});

test('bloquea tokens de escritura, actions sin pin y uploads amplios', () => {
  for (const mutate of [
    (ci) => {
      ci.permissions.contents = 'write';
    },
    (ci) => {
      ci.jobs.quality.steps[0].uses = 'actions/checkout@main';
    },
    (ci) => {
      ci.jobs.unit.steps.at(-1).with.path = 'reports/**';
    },
  ]) {
    const docs = documents();
    mutate(docs[0]);
    assert.throws(() => validateWorkflows(...docs));
  }
});

test('revisión de main no puede emitirse en pushes ni convertirse en skip', () => {
  for (const mutate of [
    (review) => {
      review.on.push = { branches: ['test'] };
    },
    (review) => {
      review.jobs['main-review'].if = false;
    },
    (review) => {
      delete review.jobs['main-review'].environment;
    },
  ]) {
    const docs = documents();
    mutate(docs[1]);
    assert.throws(() => validateWorkflows(...docs));
  }
});
