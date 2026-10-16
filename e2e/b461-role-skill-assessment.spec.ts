import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const evidenceDirectory = e2eEvidenceDirectory('B461');

async function openAssessment(page: Page, width: number): Promise<void> {
  await mockSignedInCabinet(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (width <= 760) {
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
  } else {
    await page.locator('aside#career-rail nav').getByRole('button', { name: 'Профиль' }).click();
  }
  await page.getByRole('tab', { name: /^Навыки/u }).click();
  const consultant = page.locator('.career-expert-panel');
  if (!(await consultant.isVisible())) {
    const desktopTrigger = page
      .locator('.career-desktop-topbar')
      .getByRole('button', { name: 'Открыть консультанта', exact: true });
    if (await desktopTrigger.isVisible()) {
      await desktopTrigger.click();
    } else {
      await page
        .getByRole('button', { name: /^((Спросить|Открыть) консультанта|Консультант: открыть)$/u })
        .first()
        .click();
    }
  }
  await expect(consultant).toBeVisible();
  const expand = consultant.getByRole('button', { name: 'Развернуть консультанта' });
  if (await expand.isVisible()) await expand.click();
  await consultant.getByRole('button', { name: 'Проверить навыки роли' }).click();
  await expect(page.getByTestId('role-skill-assessment')).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${evidenceDirectory}/${name}.png`, fullPage: true });
  if (
    /-start$|-dialogue-resumed$|-case-1-resumed$|-case-1-model-error$|-case-1-evaluation$|-result$/u.test(
      name,
    )
  ) {
    const html = await page.evaluate(snapshotInteractivePage);
    writeFileSync(`${evidenceDirectory}/${name}.html`, html);
  }
}

function snapshotInteractivePage(): string {
  function copyControlState(source: Element, target?: Element): void {
    if (!target) return;
    if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      target.setAttribute('value', source.value);
      if (source.checked) target.setAttribute('checked', '');
      else target.removeAttribute('checked');
    } else if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
      target.textContent = source.value;
    } else if (source instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
      target.value = source.value;
    }
  }
  const styles = Array.from(document.styleSheets).flatMap((sheet) => {
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText);
    } catch {
      return [];
    }
  });
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, link[rel="stylesheet"], style').forEach((node) => node.remove());
  const sourceControls = Array.from(document.querySelectorAll('input, textarea, select'));
  const copiedControls = Array.from(clone.querySelectorAll('input, textarea, select'));
  sourceControls.forEach((source, index) => copyControlState(source, copiedControls[index]));
  const style = document.createElement('style');
  style.textContent = styles.join('\n');
  clone.querySelector('head')?.append(style);
  return `<!doctype html>${clone.outerHTML}`;
}

async function checkAccessibility(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).include('.career-role-assessment').analyze();
  expect(
    result.violations
      .filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))
      .map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
  ).toEqual([]);
}

async function checkNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function resumeSavedDialogue(page: Page): Promise<void> {
  await page.getByLabel('Согласен передать ответы модели для проверки по критериям.').check();
  await page.getByRole('button', { name: 'Начать проверку' }).click();
  await expect(page.getByLabel('Ваш ответ')).toBeVisible();
  await page
    .getByLabel('Ваш ответ')
    .fill('Я отвечал за запуск платёжного направления и координировал команду.');
  await page.getByRole('button', { name: 'Ответить' }).click();
  await expect(page.getByText(assessmentQuestionTwo)).toBeVisible();
  await page.getByRole('button', { name: 'Назад к профилю' }).click();
  await expect(page.getByTestId('role-skill-assessment')).toHaveCount(0);
  const consultant = page.locator('.career-expert-panel');
  if (!(await consultant.isVisible())) {
    await page
      .getByRole('button', { name: /^((Спросить|Открыть) консультанта|Консультант: открыть)$/u })
      .first()
      .click();
  }
  const expand = consultant.getByRole('button', { name: 'Развернуть консультанта' });
  if (await expand.isVisible()) await expand.click();
  await consultant.getByRole('button', { name: 'Проверить навыки роли' }).click();
  await expect(
    page.getByText('Я отвечал за запуск платёжного направления и координировал команду.'),
  ).toBeVisible();
  await capture(page, `${viewportName(page)}-dialogue-resumed`);
}

const assessmentQuestionTwo =
  'Какой результат вашей работы можно подтвердить наблюдаемым фактом или показателем?';

async function answerDialogue(page: Page, width: number): Promise<void> {
  const answer = page.getByLabel('Ваш ответ');
  for (let index = 1; index < 3; index += 1) {
    await answer.fill(`Опишу результат и проверяемый факт для вопроса ${index + 1}.`);
    await page.getByRole('button', { name: 'Ответить' }).click();
    if (index === 1) {
      await expect(page.getByText('Шаг 3 из 3')).toBeVisible();
      await capture(page, `${width}-dialogue-3`);
    } else {
      await expect(page.getByRole('heading', { name: 'Что добавить в профиль' })).toBeVisible();
    }
  }
  await capture(page, `${width}-suggestions`);
}

async function acceptProfileSuggestion(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Снять выбор' }).click();
  const firstSuggestion = page.locator('.career-role-assessment-suggestion').first();
  await firstSuggestion.locator('input[type="checkbox"]').check();
  await firstSuggestion
    .getByRole('textbox')
    .fill('Запустил платёжное направление и согласовал план с командой.');
  await page.getByRole('button', { name: 'Принять выбранное и перейти к кейсам' }).click();
  await expect(page.getByText('Кейс 1 из 3')).toBeVisible();
  await expect(page.locator('.career-role-assessment-profile-change')).toContainText(
    'Добавлено в профиль: 1 факт',
  );
  await checkAccessibility(page);
  await page.getByRole('button', { name: 'Отменить добавление в профиль' }).click();
  await checkAccessibility(page);
  await page.getByRole('button', { name: 'Подтвердить отмену' }).click();
  await expect(page.getByText(/Добавление отменено/u)).toBeVisible();
}

async function discussAndEvaluateFirstCase(page: Page, width: number): Promise<void> {
  await page.getByRole('button', { name: 'Обсудить условие' }).first().click();
  await page.getByLabel('Что уточнить в условии?').fill('Какой масштаб команды нужно учитывать?');
  await page.getByRole('button', { name: 'Обсудить условие' }).last().click();
  await expect(
    page.getByText('Рассмотрите масштаб решения и результат для команды.'),
  ).toBeVisible();
  const answer = page.getByLabel('Ваш ответ на кейс');
  const savedAnswer =
    'Внедрил платёжный шлюз, сократил ошибки и проверил результат по журналам операций.';
  await answer.fill(savedAnswer);
  await expect(page.getByText(/сохраняем черновик/u)).toBeVisible();
  await expect(page.getByText(/сохраняем черновик/u)).toBeHidden({ timeout: 5000 });
  await page.getByRole('button', { name: 'Назад к профилю' }).click();
  await reopenAssessment(page);
  await expect(page.getByLabel('Ваш ответ на кейс')).toHaveValue(savedAnswer);
  await capture(page, `${width}-case-1-resumed`);
  const submit = page.getByRole('button', { name: 'Пройти кейс' });
  await expect(submit).toBeEnabled({ timeout: 5000 });
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Модель не завершила проверку' })).toBeVisible();
  await capture(page, `${width}-case-1-model-error`);
  await page.getByRole('button', { name: 'Повторить шаг' }).click();
  await expect(page.getByLabel('Ваш ответ на кейс')).toHaveValue(savedAnswer);
  await page.getByRole('button', { name: 'Пройти кейс' }).click();
  await expect(page.getByRole('heading', { name: 'Почему так' })).toBeVisible();
  await capture(page, `${width}-case-1-evaluation`);
  await page.getByRole('button', { name: 'Оспорить оценку' }).click();
  await page.getByLabel('Что не учтено в оценке?').fill('Учтите ещё влияние на команду поддержки.');
  await page.getByRole('button', { name: 'Оспорить оценку' }).last().click();
  await expect(page.getByText('Подтверждено', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Дополнить ответ' }).click();
  await answer.fill(' В дополнение: подготовил план отката и обучил поддержку.');
  await page.getByRole('button', { name: 'Дополнить и переоценить' }).click();
  await expect(page.getByRole('button', { name: 'Перейти к следующему кейсу' })).toBeVisible();
}

async function reopenAssessment(page: Page): Promise<void> {
  const consultant = page.locator('.career-expert-panel');
  if (!(await consultant.isVisible())) {
    await page
      .getByRole('button', { name: /^((Спросить|Открыть) консультанта|Консультант: открыть)$/u })
      .first()
      .click();
  }
  const expand = consultant.getByRole('button', { name: 'Развернуть консультанта' });
  if (await expand.isVisible()) await expand.click();
  await consultant.getByRole('button', { name: 'Проверить навыки роли' }).click();
  await expect(page.getByText('Кейс 1 из 3')).toBeVisible();
}

async function finishRemainingCases(page: Page, width: number): Promise<void> {
  await page.getByRole('button', { name: 'Перейти к следующему кейсу' }).click();
  await expect(page.getByText('Кейс 2 из 3')).toBeVisible();
  await capture(page, `${width}-case-2`);
  await page.getByRole('button', { name: 'Пропустить кейс' }).click();
  await expect(page.getByText('Кейс 3 из 3')).toBeVisible();
  await capture(page, `${width}-case-3`);
  await page
    .getByLabel('Ваш ответ на кейс')
    .fill('Согласовал бюджет, сроки и показатели результата для руководства.');
  const submit = page.getByRole('button', { name: 'Пройти кейс' });
  await expect(submit).toBeEnabled({ timeout: 5000 });
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Роль пока не открылась' })).toBeVisible();
  await expect(page.getByText('Кейс пропущен; это не означает отсутствия опыта.')).toBeVisible();
  await capture(page, `${width}-result`);
  await checkAccessibility(page);
  await refreshStaleResult(page, width);
}

async function refreshStaleResult(page: Page, width: number): Promise<void> {
  await page.getByRole('button', { name: 'Назад к профилю' }).click();
  const consultant = page.locator('.career-expert-panel');
  if (!(await consultant.isVisible())) {
    await page
      .getByRole('button', { name: /^((Спросить|Открыть) консультанта|Консультант: открыть)$/u })
      .first()
      .click();
  }
  const expand = consultant.getByRole('button', { name: 'Развернуть консультанта' });
  if (await expand.isVisible()) await expand.click();
  await consultant.getByRole('button', { name: 'Проверить навыки роли' }).click();
  await expect(page.getByText('Результат устарел.', { exact: false })).toBeVisible();
  await capture(page, `${width}-stale-result`);
  const consent = page.getByLabel('Согласен передать ответы модели для новой проверки.');
  await expect(page.getByRole('button', { name: 'Освежить навыки' })).toBeDisabled();
  await consent.check();
  await page.getByRole('button', { name: 'Освежить навыки' }).click();
  await expect(page.getByLabel('Ваш ответ')).toBeVisible();
}

function viewportName(page: Page): string {
  return `resume-${page.viewportSize()?.width ?? 0}`;
}

test('runs role-skill assessment and preserves the saved step on desktop and mobile', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(
    testInfo.project.name !== 'desktop-1440',
    'The desktop runner drives both viewport sizes.',
  );
  mkdirSync(evidenceDirectory, { recursive: true });
  const mobilePage = await page.context().newPage();
  try {
    for (const [runner, width] of [
      [page, 1440],
      [mobilePage, 390],
    ] as const) {
      await openAssessment(runner, width);
      await expect(runner.getByRole('heading', { name: 'Что проверяем' })).toBeVisible();
      await capture(runner, `${width}-start`);
      await checkAccessibility(runner);
      await resumeSavedDialogue(runner);
      await answerDialogue(runner, width);
      await acceptProfileSuggestion(runner);
      await capture(runner, `${width}-case-1`);
      await discussAndEvaluateFirstCase(runner, width);
      await finishRemainingCases(runner, width);
      for (const viewportWidth of [280, 320, 390, 414]) {
        await runner.setViewportSize({ width: viewportWidth, height: 844 });
        await checkNoHorizontalOverflow(runner);
      }
    }
  } finally {
    await mobilePage.close();
  }
});
