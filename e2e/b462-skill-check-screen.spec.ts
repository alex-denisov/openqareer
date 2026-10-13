import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import {
  mockSignedInCabinet,
  type MockSignedInCabinetOptions,
} from './fixtures/mockSignedInCabinet';

const evidenceDirectory = e2eEvidenceDirectory('B462');

async function openAssessment(
  page: Page,
  width: number,
  options: MockSignedInCabinetOptions = {},
): Promise<void> {
  await mockSignedInCabinet(page, options);
  await page.setViewportSize({ width, height: width <= 760 ? 844 : 900 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (width <= 760) {
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
  } else {
    await page.locator('aside#career-rail nav').getByRole('button', { name: 'Профиль' }).click();
  }
  await page.getByRole('tab', { name: /^Навыки/u }).click();
  const consultant = page.locator('aside.career-expert-panel');
  if (!(await consultant.isVisible())) {
    const desktopTrigger = page
      .locator('.career-desktop-topbar')
      .getByRole('button', { name: 'Открыть консультанта', exact: true });
    if (await desktopTrigger.isVisible()) {
      await desktopTrigger.click();
    } else {
      await page
        .getByRole('button', { name: /^(Спросить|Открыть) консультанта$/u })
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
  writeFileSync(`${evidenceDirectory}/${name}.html`, await page.evaluate(snapshotPage));
}

function snapshotPage(): string {
  function copyControl(source: Element, target?: Element): void {
    if (!target) return;
    if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      target.setAttribute('value', source.value);
      if (source.checked) target.setAttribute('checked', '');
      else target.removeAttribute('checked');
    } else if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
      target.textContent = source.value;
    }
  }
  const rules = Array.from(document.styleSheets).flatMap((sheet) => {
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText);
    } catch {
      return [];
    }
  });
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, link[rel="stylesheet"], style').forEach((node) => node.remove());
  const source = Array.from(document.querySelectorAll('input, textarea'));
  const copied = Array.from(clone.querySelectorAll('input, textarea'));
  source.forEach((control, index) => copyControl(control, copied[index]));
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  clone.querySelector('head')?.append(style);
  return `<!doctype html>${clone.outerHTML}`;
}

async function expectAccessible(page: Page): Promise<void> {
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

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectMobileComposerAboveNavigation(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const composer = document.querySelector('.career-role-assessment-composer');
    const navigation = document.querySelector('.career-mobile-nav');
    const actions = document.querySelector('.career-role-assessment-dialogue-action-area');
    if (!composer || !navigation || !actions) return null;
    return {
      composerBottom: composer.getBoundingClientRect().bottom,
      navigationTop: navigation.getBoundingClientRect().top,
      actionsTop: actions.getBoundingClientRect().top,
      composerTop: composer.getBoundingClientRect().top,
    };
  });
  expect(layout).not.toBeNull();
  expect(layout!.composerBottom).toBeLessThanOrEqual(layout!.navigationTop + 1);
  expect(layout!.actionsTop).toBeLessThan(layout!.composerTop);
}

async function expectMobileAssessmentTitleInViewport(page: Page): Promise<void> {
  const top = await page
    .locator('.career-role-assessment-header h1')
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(220);
}

async function expectState(page: Page, name: string): Promise<void> {
  const headings: Record<string, string> = {
    start: 'Что проверяем',
    'empty-role': 'Сначала выберите роль',
    'low-vacancies': 'Пока мало вакансий для проверки',
    requirements: 'Требований пока недостаточно',
    'source-error': 'Не удалось сверить вакансии',
    suggestions: 'Что добавить в профиль',
    'partial-result': 'Роль пока не открылась',
    'open-result': 'Ключевые навыки подтверждены',
  };
  if (name === 'loading') {
    await expect(page.locator('.career-role-assessment-state[role="status"]')).toContainText(
      'Загружаем требования',
    );
    return;
  }
  await expect(page.getByRole('heading', { name: headings[name] })).toBeVisible();
}

test('captures loading, empty, error, many, partial and open-role states at 1440 and 390', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'This runner captures both viewport sizes.');
  test.setTimeout(180_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  const variants: Array<{ name: string; options?: MockSignedInCabinetOptions }> = [
    { name: 'loading', options: { assessmentDelayMs: 6000 } },
    { name: 'start' },
    { name: 'empty-role', options: { assessmentInitialState: 'role_not_selected' } },
    { name: 'low-vacancies', options: { assessmentInitialState: 'too_few_vacancies' } },
    { name: 'requirements', options: { assessmentInitialState: 'insufficient_requirements' } },
    { name: 'source-error', options: { assessmentInitialState: 'source_unavailable' } },
    { name: 'suggestions', options: { assessmentInitialState: 'suggestions' } },
    { name: 'partial-result', options: { assessmentInitialState: 'partial_result' } },
    { name: 'open-result', options: { assessmentInitialState: 'open_result' } },
  ];
  for (const width of [1440, 390]) {
    for (const variant of variants) {
      const surface = await page.context().newPage();
      try {
        await openAssessment(surface, width, variant.options);
        await expectState(surface, variant.name);
        if (variant.name === 'suggestions') {
          await expect(surface.locator('.career-role-assessment-suggestion')).toHaveCount(12);
          await expect(surface.getByText('Предлагается: 12 из 12')).toBeVisible();
        }
        if (width === 390 && variant.name === 'start') {
          await expect(surface.getByRole('progressbar', { name: 'Шаг 1 из 5' })).toBeVisible();
        }
        if (width === 390 && variant.name === 'partial-result') {
          await expect(surface.getByRole('progressbar', { name: 'Шаг 5 из 5' })).toBeVisible();
        }
        await expectAccessible(surface);
        await expectNoOverflow(surface);
        await capture(surface, `${width}-${variant.name}`);
        if (variant.name === 'open-result') {
          await surface.getByRole('button', { name: 'Открыть вакансии роли' }).click();
          await expect(surface.getByTestId('role-skill-assessment')).toHaveCount(0);
          await expect(surface.getByRole('heading', { name: 'Вакансии', level: 1 })).toBeVisible();
        }
      } finally {
        await surface.close();
      }
    }
  }
});

async function beginDialogue(page: Page): Promise<void> {
  await page.getByLabel('Согласен передать ответы модели для проверки по критериям.').check();
  await page.getByRole('button', { name: 'Начать проверку' }).click();
}

async function answerDialogue(page: Page, width: number): Promise<void> {
  const answer = page.getByLabel('Ваш ответ');
  for (let index = width === 390 ? 1 : 0; index < 3; index += 1) {
    await answer.fill(`Факт и результат по вопросу ${index + 1}.`);
    if (width <= 760 && index === 0) {
      await expect(page.getByRole('button', { name: 'Голосовой ввод' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Ответить' })).toBeVisible();
      await answer.fill('');
      await expect(page.getByRole('button', { name: 'Голосовой ввод' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ответить' })).toHaveCount(0);
      await answer.fill(`Факт и результат по вопросу ${index + 1}.`);
    }
    await page.getByRole('button', { name: 'Ответить' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Что добавить в профиль' })).toBeVisible();
}

async function installSpeechRecognitionStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeLocalSpeechRecognition {
      static available = async () => 'available';
      processLocally = false;
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: never) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        Object.assign(window, { roleSkillRecognition: this });
        this.onstart?.();
      }

      stop() {
        this.onend?.();
      }

      abort() {
        this.onend?.();
      }
    }
    Object.assign(window, { SpeechRecognition: FakeLocalSpeechRecognition });
  });
}

async function answerUsingVoice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Голосовой ввод' }).click();
  await page.getByRole('button', { name: 'Разрешить микрофон' }).click();
  await expect(page.getByText('Идёт запись')).toBeVisible();
  await capture(page, '390-dialogue-recording');
  await page.evaluate(() => {
    const recognition = (
      window as Window & {
        roleSkillRecognition?: { onresult?: (event: never) => void };
      }
    ).roleSkillRecognition;
    recognition?.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: 'Команда сократила срок поставки на треть.' } }],
    } as never);
  });
  await page.getByRole('button', { name: 'Закончить запись' }).click();
  await expect(page.getByRole('button', { name: 'Отправить голосом' })).toBeVisible();
  await capture(page, '390-dialogue-transcribed');
  await page.getByRole('button', { name: 'Отправить голосом' }).click();
  await expect(page.getByText('Шаг 2 из 3')).toBeVisible();
}

test('connects mobile checklist, suggestions, detail screens and role links', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'This runner drives both viewport sizes.');
  test.setTimeout(120_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  const context = page.context();
  for (const width of [1440, 390]) {
    const surface = await context.newPage();
    try {
      if (width === 390) await installSpeechRecognitionStub(surface);
      await openAssessment(surface, width);
      await surface.getByRole('button', { name: 'Позже' }).click();
      await expect(surface.getByTestId('role-skill-assessment')).toHaveCount(0);
      await surface
        .getByRole('button', { name: /^(Спросить|Открыть) консультанта$/u })
        .first()
        .click();
      const consultant = surface.locator('aside.career-expert-panel');
      const expand = consultant.getByRole('button', { name: 'Развернуть консультанта' });
      if (await expand.isVisible()) await expand.click();
      await consultant.getByRole('button', { name: 'Проверить навыки роли' }).click();
      await beginDialogue(surface);
      await capture(surface, `${width}-dialogue`);
      if (width === 390) {
        await expectMobileAssessmentTitleInViewport(surface);
        await expectMobileComposerAboveNavigation(surface);
        await expect(surface.getByRole('progressbar', { name: 'Шаг 1 из 5' })).toBeVisible();
        await surface.getByRole('button', { name: 'Навыки 0/5' }).click();
        await expect(
          surface.locator('.career-role-assessment-header').getByRole('heading', {
            name: 'Что проверяем',
          }),
        ).toBeVisible();
        await capture(surface, `${width}-skills-push`);
        await surface.getByRole('button', { name: 'Назад к диалогу' }).click();
        await expect(surface.getByLabel('Ваш ответ')).toBeVisible();
        await expect(surface.getByRole('button', { name: 'К кейсам' })).toBeDisabled();
        await expect(surface.getByRole('button', { name: 'Пропустить' })).toBeDisabled();
        await expect(surface.getByRole('button', { name: 'Голосовой ввод' })).toBeVisible();
        await expect(surface.getByRole('button', { name: 'Ответить' })).toHaveCount(0);
      }
      if (width === 390) await answerUsingVoice(surface);
      await answerDialogue(surface, width);
      await capture(surface, `${width}-dialogue-summary`);
      await expect(surface.locator('.career-role-assessment-suggestion input:checked')).toHaveCount(
        12,
      );
      if (width === 1440) {
        await surface.getByRole('button', { name: 'Принять всё' }).click();
        await expect(surface.locator('.career-role-assessment-profile-change')).toContainText(
          'Добавлено в профиль: 12 фактов',
        );
        await surface.getByRole('button', { name: 'Отменить добавление в профиль' }).click();
        await surface.getByRole('button', { name: 'Подтвердить отмену' }).click();
        await expect(surface.getByText(/Добавление отменено/u)).toBeVisible();
      } else {
        await surface.getByRole('button', { name: 'Снять выбор' }).click();
        await surface.getByRole('button', { name: 'Перейти без добавления' }).click();
        await expect(surface.locator('.career-role-assessment-profile-change')).toHaveCount(0);
      }
      await expect(surface.getByText('Кейс 1 из 3')).toBeVisible();
      if (width === 390) {
        await expect(surface.getByRole('progressbar', { name: 'Шаг 2 из 5' })).toBeVisible();
        await expectMobileAssessmentTitleInViewport(surface);
      }
      await capture(surface, `${width}-case-input`);
    } finally {
      await surface.close();
    }
  }
  for (const width of [1440, 390]) {
    const surface = await context.newPage();
    try {
      await openAssessment(surface, width, { assessmentInitialState: 'partial_result' });
      await expect(surface.getByRole('heading', { name: 'Роль пока не открылась' })).toBeVisible();
      await surface
        .locator('.career-role-assessment-skill-results')
        .getByRole('button', { name: 'Подробнее' })
        .nth(2)
        .click();
      await expect(
        surface.getByRole('heading', { name: 'Регуляторика (ЦБ, PCI DSS)', level: 2 }),
      ).toBeVisible();
      if (width === 390) await expectMobileAssessmentTitleInViewport(surface);
      await capture(surface, `${width}-skill-detail`);
      await surface.getByRole('button', { name: 'Назад к итогу' }).click();
      await expect(surface.getByRole('heading', { name: 'Роль пока не открылась' })).toBeVisible();
      await surface.getByRole('button', { name: 'Вернуться к ролям' }).click();
      await expect(surface.getByTestId('role-skill-assessment')).toHaveCount(0);
    } finally {
      await surface.close();
    }
  }
});

test('adds only selected suggestions on desktop and mobile', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'This runner drives both viewport sizes.');
  test.setTimeout(60_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  for (const width of [1440, 390]) {
    const surface = await page.context().newPage();
    try {
      await openAssessment(surface, width, { assessmentInitialState: 'suggestions' });
      await expect(surface.getByRole('heading', { name: 'Что добавить в профиль' })).toBeVisible();
      await surface.getByRole('button', { name: 'Снять выбор' }).click();
      await surface.locator('.career-role-assessment-suggestion input').first().check();
      await expect(surface.getByText('Предлагается: 12 из 12 · Отмечено: 1')).toBeVisible();
      await surface.getByRole('button', { name: 'Принять выбранное и перейти к кейсам' }).click();
      await expect(surface.locator('.career-role-assessment-profile-change')).toContainText(
        'Добавлено в профиль: 1 факт',
      );
      await expect(surface.getByText('Кейс 1 из 3')).toBeVisible();
      await expectAccessible(surface);
      await expectNoOverflow(surface);
      await capture(surface, `${width}-selected-suggestions`);
    } finally {
      await surface.close();
    }
  }
});
