import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'src/services/*.ts',
        'src/features/evidence/evidenceEngine.ts',
        'src/features/opportunity/opportunityEngine.ts',
        'src/features/workspace/workspaceStorage.ts',
        'server/config.ts',
        'server/domain/coach.ts',
        'server/providers/openAICoachProvider.ts',
        'server/providers/openRouterCoachProvider.ts',
        'server/providers/privacyAwareCoachProvider.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
