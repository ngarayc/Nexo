import { defineConfig } from 'vitest/config';
import { transform as transformTypeScript } from '@swc/core';

export default defineConfig({
  plugins: [
    {
      name: 'nexo-test-decorator-metadata',
      enforce: 'pre',
      async transform(source, id) {
        if (!id.endsWith('.ts')) return;
        return transformTypeScript(source, {
          filename: id,
          sourceMaps: true,
          jsc: {
            parser: { syntax: 'typescript', decorators: true },
            target: 'es2023',
            transform: { legacyDecorator: true, decoratorMetadata: true },
          },
          module: { type: 'es6' },
        });
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: false,
    retry: 0,
    reporters: ['default'],
  },
});
