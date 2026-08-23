import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// B042 establishes a fail-closed baseline without turning this tooling ticket
// into a rewrite of every pre-existing large module. New production files get
// the 800/50/4 limits below; these named legacy files retain explicit debt.
const legacyComplexityFiles = [
  'scripts/split-browser-entry.mjs',
  'scripts/verify-built-shell.mjs',
  'server/config.ts',
  'server/connectors/connectorHarness.ts',
  'server/connectors/hhVacancySearch.ts',
  'server/connectors/hostedApplicationBrowser.ts',
  'server/connectors/officialOAuthTransport.ts',
  'server/data/sqliteCandidateStore.ts',
  'server/providers/openAICoachProvider.ts',
  'server/providers/openAICompatibleCoachProvider.ts',
  'server/providers/openRouterCoachProvider.ts',
  'src/App.tsx',
  'src/features/career-map/roleMarketMap.ts',
  'src/features/connections/AccountConnections.tsx',
  'src/features/diagnostic/careerDiagnostic.ts',
  'src/features/evidence/evidenceEngine.ts',
  'src/features/journey/CareerExpertPanel.tsx',
  'src/features/journey/CareerIntake.tsx',
  // B154: CareerJourneyViews.tsx (1358 lines) was split into journeyViews/*;
  // the >50-line screen components moved verbatim and stay baselined until
  // their owning UI tickets decompose them further.
  'src/features/journey/journeyViews/TodayJourneyView.tsx',
  'src/features/journey/journeyViews/ProfileJourneyView.tsx',
  'src/features/journey/journeyViews/CareerMapView.tsx',
  'src/features/journey/journeyViews/OpportunitiesView.tsx',
  'src/features/journey/careerJourneyEngine.ts',
  'src/features/next-action/careerActionPolicy.ts',
  'src/features/opportunity/opportunityEngine.ts',
  'src/features/outcome/outcomeEngine.ts',
  'src/features/shell/CareerAccountPanel.tsx',
  'src/features/shell/CareerTariffsView.tsx',
  'src/features/shell/CareerWorkspaceShell.tsx',
  'src/features/workspace/workspaceStorage.ts',
  'src/services/coverLetter.ts',
];

export default tseslint.config(
  {
    ignores: [
      '.agents/**',
      '.antigravity/**',
      '.claude/**',
      '.codex/**',
      '.gemini/**',
      '.opencode/**',
      '.qwen/**',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'output/**',
      'playwright-report/**',
      'prototypes/**',
      'test-results/**',
      '.serena/**',
      'src-tauri/target/**',
      'mcp-server/**',
      'scripts/auth_setup.js',
      'scripts/export_all_connections.js',
      'scripts/fetch_connections.js',
      'scripts/publish_post.js',
      'scripts/recommend_contacts.js',
      'scripts/search_and_score_jobs.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: [
      'src/**/*.{js,jsx,ts,tsx}',
      'server/**/*.{js,jsx,ts,tsx}',
      'scripts/**/*.{js,mjs,ts,tsx}',
    ],
    rules: {
      'max-depth': ['error', 4],
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
  {
    files: ['**/*.test.{js,mjs,ts,tsx}', '**/*.spec.{js,mjs,ts,tsx}'],
    rules: {
      // Test scenarios may be long narratives; production functions keep the 50-line gate.
      'max-lines-per-function': 'off',
    },
  },
  {
    files: legacyComplexityFiles,
    rules: {
      'max-depth': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: globals.nodeBuiltin,
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['src/services/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react-dom/*', '@phosphor-icons/*'],
              message: 'src/services must remain independent from React and the DOM.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
