import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateWorkflows } from './workflow-policy.mjs';

const files = [
  '.github/workflows/ci.yml',
  '.github/workflows/main-review.yml',
  '.github/actions/setup-project/action.yml',
  '.github/workflows/expanded.yml',
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

test('ampliado rechaza fuente móvil, pasos omitidos, escritura, uploads crudos y SHA sin guardia', () => {
  for (const mutate of [
    (workflow) => {
      workflow.on.push = {};
    },
    (workflow) => {
      workflow.permissions.contents = 'write';
    },
    (workflow) => {
      workflow.jobs.expanded.steps[0].run = 'true';
    },
    (workflow) => {
      workflow.jobs.expanded.steps[1].with.ref = 'main';
    },
    (workflow) => {
      workflow.jobs.expanded.steps[2].if = false;
    },
    (workflow) => {
      workflow.jobs.expanded.steps.at(-1).with.path = 'reports/**';
    },
    (workflow) => {
      workflow.jobs.expanded['continue-on-error'] = true;
    },
  ]) {
    const documents = files.map((file) => parse(readFileSync(file, 'utf8')));
    mutate(documents[3]);
    assert.throws(() => validateWorkflows(...documents));
  }
});
