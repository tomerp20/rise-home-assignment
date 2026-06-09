import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    // ddb-exec.bundle.js is a generated esbuild bundle (AWS SDK inlined).
    ignores: ['dist/', 'node_modules/', 'src/campaigns/ddb-exec.bundle.js'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
