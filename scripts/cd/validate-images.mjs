import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateImageScan } from '../ci/results.mjs';
const statuses = JSON.parse(readFileSync('/proof/scan-status.json', 'utf8'));
for (const name of ['api', 'web', 'db', 'gateway']) {
  const report = JSON.parse(readFileSync(`/proof/${name}.json`, 'utf8'));
  const stderr = readFileSync(`/proof/${name}.scanner.log`, 'utf8');
  validateImageScan(
    report,
    { status: statuses[name].status, stderr },
    name === 'api'
      ? ['alpine', 'node-pkg']
      : name === 'gateway'
        ? ['alpine', 'gobinary']
        : ['alpine'],
  );
  assert.equal(report.Metadata.ImageID, statuses[name].id);
}
console.log('Cuatro imágenes verificadas; sin HIGH/CRITICAL ni escaneos inconclusos.');
