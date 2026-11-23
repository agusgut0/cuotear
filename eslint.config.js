import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', '.state/', 'coverage/', 'spike-results/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Store adapters must go through the shared FetchContext (DRT section 5).
    files: ['src/stores/**/*.js'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use the FetchContext instead of calling fetch directly.' },
      ],
    },
  },
];
