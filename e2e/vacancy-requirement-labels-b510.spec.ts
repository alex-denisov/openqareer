import { expect, test, type Page } from '@playwright/test';
import type { VacancyFitView } from '../shared/vacancyFit';
import { extractVacancyRequirements } from '../server/domain/vacancyRequirements';
import { labelVacancyRequirement } from '../server/domain/vacancyRequirementLabel';
import { BLOCK_C_LONG_REQUIREMENTS } from '../scripts/fixtures/block-c-catalog';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { matchedVacancyPage } from './fixtures/readabilityWorkspace';
import { readyVacancyFit } from './fixtures/vacancyFit';

/** Prod-like requirements (B510) through the real extractor and labeller, as the server serves them. */
function longRequirementsFit(vacancyId: string): VacancyFitView {
  const description = [
    'Requirements',
    ...BLOCK_C_LONG_REQUIREMENTS.map((line) => `- ${line}`),
  ].join('\n');
  const requirements = extractVacancyRequirements({ vacancyId, description }).requirements.map(
    labelVacancyRequirement,
  );
  const base = readyVacancyFit(vacancyId);
  return {
    ...base,
    requirements,
    result: {
      ...base.result!,
      assessments: requirements.map((item) => ({
        requirementId: item.id,
        status: 'unmatched' as const,
        evidence: [],
      })),
    },
  };
}

async function openVacancies(
  page: Page,
  shape: (fit: VacancyFitView) => VacancyFitView = (fit) => fit,
): Promise<string> {
  await mockSignedInCabinet(page, { vacancyTotal: 1 });
  const base = matchedVacancyPage(0, 1);
  const vacancyId = base.data[0]!.cluster.id;
  const fit = shape(longRequirementsFit(vacancyId));
  await page.route('**/api/v1/candidate/matched-vacancies*', (route) =>
    route.fulfill({
      json: {
        ...base,
        data: base.data.map((item) => ({
          ...item,
          explanation: { ...item.explanation, fitView: { ...fit, requirements: [] } },
        })),
      },
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/fit', (route) =>
    route.fulfill({ json: { data: fit } }),
  );
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  const trigger = page.locator('.vacancies-screen-row-trigger').first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return vacancyId;
}

test('B510: long prod requirements become short skill chips, the sentence stays in the tooltip', async ({
  page,
}) => {
  await openVacancies(page);
  const chips = page.locator('.vacancies-screen-skill-chips').first();
  await expect(chips).toBeVisible();
  const texts = (await chips.locator('.vacancies-screen-skill-chip').allInnerTexts()).map((text) =>
    text.replace(/^(?:Подтверждено|Не проверено):\s*/u, '').trim(),
  );
  expect(texts).toEqual(expect.arrayContaining(['Kafka', 'Kubernetes']));
  for (const text of texts) expect(text.split(/\s+/u).length).toBeLessThanOrEqual(5);
  await expect(chips).not.toContainText('Proven track record');
  await expect(chips.getByText('Kafka', { exact: true })).toHaveAttribute(
    'title',
    BLOCK_C_LONG_REQUIREMENTS[1],
  );
});

test('B510: parsed requirements without a short name say they arrive within the hour', async ({
  page,
}) => {
  await openVacancies(page, (fit) => ({
    ...fit,
    requirements: fit.requirements.map(({ label: _label, ...item }) => ({ ...item, skill: false })),
  }));
  const section = page.locator('.vacancies-screen-requirements').first();
  await expect(section).toContainText('Требования разбираются — появятся в течение часа');
  await expect(section.locator('.vacancies-screen-skill-chip')).toHaveCount(0);
});
