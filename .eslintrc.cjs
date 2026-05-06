module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended'],
  ignorePatterns: ['dist', 'coverage', 'node_modules'],
  rules: {
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',

    // Surface every `any` annotation as a warning. Currently ~49 pre-existing
    // (untyped SupabaseClient generics, lucide React.FC<any>, catch (err: any),
    // etc.). Goal is to drive that count to zero and then flip this to 'error'
    // so new `any` introductions block CI. Cast-style `as any` sites that are
    // genuinely unavoidable (DOM event widening, jspdf-autotable runtime
    // extension, react-router untyped state) carry an `eslint-disable-next-line`
    // comment with a justification.
    '@typescript-eslint/no-explicit-any': 'warn',

    // Block bare console.log (operational logging should use console.info,
    // console.warn, or console.error). Routes through src/lib/monitoring.ts
    // for anything destined for telemetry.
    'no-console': ['error', { allow: ['warn', 'error', 'info'] }],

    // Single source of truth for FX → USD conversion is src/lib/fx.ts.
    // Banning local re-declarations of `toUsd` in any other file prevents
    // the regression we just fixed (where 9 pages had stale, hard-coded
    // FX rate tables that silently diverged from live rates).
    'no-restricted-syntax': [
      'error',
      {
        selector: 'FunctionDeclaration[id.name="toUsd"]',
        message:
          'Do not redeclare toUsd. Import it from "@/lib/fx" — that is the single source of truth (uses live rates + FALLBACK_FX). See .eslintrc.cjs for context.',
      },
      {
        selector: 'VariableDeclarator[id.name="toUsd"]',
        message:
          'Do not redeclare toUsd. Import it from "@/lib/fx" — that is the single source of truth.',
      },
      {
        selector: 'VariableDeclarator[id.name="USD_RATES"]',
        message:
          'Do not declare local USD_RATES tables. Use `useLiveFxRates()` to get the live ratesMap, then call toUsd(amount, currency, ratesMap) from "@/lib/fx".',
      },
    ],

    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    // The canonical toUsd lives here — exempt it from the redeclare rules.
    {
      files: ['src/lib/fx.ts', 'src/lib/fx.test.ts'],
      rules: {
        'no-restricted-syntax': 'off',
      },
    },
    // Tests can use `any` freely for typing convenience in fixtures.
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
    // The Vite config and other Node-side scripts can use console.log freely.
    {
      files: ['*.config.ts', '*.config.cjs', 'scripts/**/*'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
}
