const modules = ['access', 'demo', 'ingestion', 'queries', 'realtime', 'telemetry'];
const extension = '\\.(?:ts|[cm]?js)$';
const features = {
  access: '(?:access-facade|access-guard|data-access/session-api)',
  alerts: 'alerts-facade',
  fleet: '(?:fleet-facade|vehicle-detail-facade)',
  'live-monitoring': 'live-monitor',
  'demo-replay': 'replay-facade',
};
const production = { pathNot: '\\.spec\\.ts$' };

module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'web-cannot-import-server',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/|node_modules/@nestjs/' },
    },
    {
      name: 'server-cannot-import-web',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^apps/web/|node_modules/@angular/' },
    },
    {
      name: 'contracts-cannot-import-applications',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '^apps/|node_modules/(?:@nestjs|@angular)/' },
    },
    {
      name: 'contracts-cannot-import-node',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { dependencyTypes: ['core'] },
    },
    ...modules.map((name) => ({
      name: `${name}-only-through-public-entry`,
      severity: 'error',
      from: { path: `^apps/api/src/modules/(?!${name}/)[^/]+/`, ...production },
      to: { path: `^apps/api/src/modules/${name}/(?!public${extension})` },
    })),
    {
      name: 'backend-core-cannot-import-adapters',
      severity: 'error',
      from: { path: '^apps/api/src/modules/[^/]+/(?:domain|application)/', ...production },
      to: { path: '^apps/api/src/(?:platform/|modules/[^/]+/adapters/)' },
    },
    {
      name: 'domain-cannot-import-application',
      severity: 'error',
      from: { path: '^apps/api/src/modules/[^/]+/domain/', ...production },
      to: { path: '^apps/api/src/modules/[^/]+/(?:application/|[^/]+\\.module\\.)' },
    },
    {
      name: 'backend-core-cannot-import-framework-or-database',
      severity: 'error',
      from: { path: '^apps/api/src/modules/[^/]+/(?:domain|application)/', ...production },
      to: { path: 'node_modules/(?:@nestjs/|(?:pg|pg-boss|drizzle-orm)(?:/|$))' },
    },
    {
      name: 'domain-cannot-import-node',
      severity: 'error',
      from: { path: '^apps/api/src/modules/[^/]+/domain/', ...production },
      to: { dependencyTypes: ['core'] },
    },
    ...Object.entries(features).map(([name, entry]) => ({
      name: `${name}-feature-public-surface`,
      severity: 'error',
      from: { path: `^apps/web/src/app/features/(?!${name}/)[^/]+/`, ...production },
      to: { path: `^apps/web/src/app/features/${name}/(?!${entry}${extension})` },
    })),
    {
      name: 'web-platform-cannot-import-features',
      severity: 'error',
      from: { path: '^apps/web/src/app/platform/', ...production },
      to: { path: '^apps/web/src/app/features/' },
    },
    {
      name: 'facades-cannot-import-presentation',
      severity: 'error',
      from: { path: '^apps/web/src/app/features/[^/]+/[^/]*-facade' + extension },
      to: {
        path:
          '^apps/web/src/app/features/[^/]+/(?:adapters/|[^/]*(?:-page|-table|-map|-history|-trajectory|-speed-chart|-panel)' +
          extension +
          ')|node_modules/(?:leaflet|chart\\.js)/',
      },
    },
    {
      name: 'web-transports-cannot-import-features',
      severity: 'error',
      from: {
        path: '^apps/web/src/app/(?:platform/(?:telemetry|replay)/|features/[^/]+/data-access/)',
        ...production,
      },
      to: { path: '^apps/web/src/app/features/' },
    },
    {
      name: 'presentation-cannot-import-transport-or-facades',
      severity: 'error',
      from: {
        path:
          '^apps/web/src/app/features/(?:fleet/(?:fleet-table|fleet-map|vehicle-history|vehicle-trajectory|vehicle-speed-chart)|alerts/alerts-table)' +
          extension,
      },
      to: {
        path:
          '^apps/web/src/app/(?:features/[^/]+/[^/]*-facade' +
          extension +
          '|platform/telemetry/(?:telemetry-api|stream-transport)' +
          extension +
          ')|node_modules/@angular/common/(?:http|fesm[^/]+/http)',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.mjs', '.json'] },
  },
};
