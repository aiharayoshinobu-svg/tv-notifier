import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'build/**', '**/.wrangler/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['docs/**/*.js'], languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } } },
  { files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.mjs'], languageOptions: { globals: globals.node } },
);
