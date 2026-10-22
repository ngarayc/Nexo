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
  ],
  options: {
    exclude: { path: '^(?:apps/(?:api|web)/dist/|packages/contracts/dist/|apps/web/\\.angular/)' },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.mjs', '.json'] },
  },
};
