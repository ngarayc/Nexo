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
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.mjs', '.json'] },
  },
};
