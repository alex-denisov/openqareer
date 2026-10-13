import type { Page } from '@playwright/test';
import { candidate, workspace } from '../fixtures/readabilityWorkspace';

export async function seedReadabilityWorkspace(page: Page): Promise<void> {
  await page.addInitScript(
    ({ ownerId, storedWorkspace }) => {
      window.localStorage.setItem('candidate-workspace', JSON.stringify(storedWorkspace));
      window.localStorage.setItem('candidate-workspace-owner', ownerId);
    },
    {
      ownerId: candidate.candidateId,
      storedWorkspace: {
        ...workspace,
        version: 7,
        createdAt: '2026-09-18T10:00:00.000Z',
        updatedAt: '2026-09-18T10:00:00.000Z',
        outcomes: [],
      },
    },
  );
}
