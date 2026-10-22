import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.angular/**', '**/coverage/**'] },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { parserOptions: { projectService: true } },
  },
  {
    files: ['tests/system/**/*.mjs'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly' } },
  },
  {
    files: ['apps/web/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
  },
  {
    files: ['apps/web/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
);
