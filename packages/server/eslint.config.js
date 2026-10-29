import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.test-dist/**', 'coverage/**', 'assets/**', 'node_modules/**'] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      eqeqeq: 'error',
      'no-console': 'error',
    },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  { files: ['scripts/**'], rules: { 'no-console': 'off' } },
  { files: ['test/**/*.ts'], rules: { '@typescript-eslint/no-floating-promises': 'error', '@typescript-eslint/require-await': 'off', '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-base-to-string': 'off', '@typescript-eslint/no-redundant-type-constituents': 'off', '@typescript-eslint/unbound-method': 'off', '@typescript-eslint/no-unnecessary-condition': 'off' } },
);
