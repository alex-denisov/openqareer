import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { waitForCareerShell } from './helpers/waitForCareerShell';

interface VoiceTestControl {
  starts: number;
  lastProcessLocally: boolean;
  transcribe: (text: string) => void;
  deny: (code?: string) => void;
}

async function installLocalRecognitionMock(page: Page) {
  await page.addInitScript(() => {
    class FakeRecognition {
      static latest: FakeRecognition | undefined;
      static async available(options: { langs: string[]; processLocally: boolean }) {
        return options.processLocally && options.langs.includes('ru-RU')
          ? 'available'
          : 'unavailable';
      }
      processLocally = false;
      lang = '';
      continuous = false;
      interimResults = false;
      onstart?: () => void;
      onresult?: (event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void;
      onerror?: (event: { error: string }) => void;
      onend?: () => void;

      constructor() {
        FakeRecognition.latest = this;
      }

      start() {
        control.starts += 1;
        control.lastProcessLocally = this.processLocally;
        queueMicrotask(() => this.onstart?.());
      }

      stop() {
        this.onend?.();
      }

      abort() {
        this.onend?.();
      }
    }

    const control: VoiceTestControl = {
      starts: 0,
      lastProcessLocally: false,
      transcribe(text) {
        const results = [{ isFinal: true, 0: { transcript: text } }];
        FakeRecognition.latest?.onresult?.({ resultIndex: 0, results });
      },
      deny(code = 'not-allowed') {
        FakeRecognition.latest?.onerror?.({ error: code });
        FakeRecognition.latest?.onend?.();
      },
    };
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeRecognition,
    });
    Object.defineProperty(window, '__voiceTestControl', {
      configurable: true,
      value: control,
    });
  });
}

async function openConsultant(page: Page) {
  await mockSignedInCabinet(page);
  await installLocalRecognitionMock(page);
  let sentTurn: Record<string, unknown> | null = null;
  await page.route('**/api/v1/coach/turn*', async (route) => {
    sentTurn = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        data: {
          message: 'Разберём ответ по фактам.',
          phase: 'interviews',
          memoryCandidates: [],
          nextQuestion: null,
          completeness: { known: [], unknown: [] },
          safety: { needsHuman: false, reason: null },
          actionProposals: [],
        },
      },
    });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await waitForCareerShell(page);
  const expertPanel = page.locator('aside.career-expert-panel');
  if ((page.viewportSize()?.width ?? 1440) <= 760 && !(await expertPanel.isVisible())) {
    await page
      .getByRole('button', { name: /^(Спросить|Открыть) консультанта$/ })
      .first()
      .click();
  }
  await expect(expertPanel).toBeVisible();
  await expect(page.locator('#career-expert-input')).toBeVisible();
  return {
    getSentTurn: () => sentTurn,
    getControl: () =>
      page.evaluate(
        () => (window as Window & { __voiceTestControl?: VoiceTestControl }).__voiceTestControl,
      ),
  };
}

async function saveEvidence(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`B463-${name}-${testInfo.project.name}.png`),
    fullPage: true,
  });
  const snapshot = await page.evaluate(() => {
    const shell = document.querySelector('.career-shell');
    const panel = shell?.querySelector('.career-expert-panel');
    const styles = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules, (rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    const markup =
      shell && panel
        ? `<div class="${shell.className}">${panel.outerHTML}</div>`
        : document.body.innerHTML;
    return { markup, styles };
  });
  await writeFile(
    testInfo.outputPath(`B463-${name}-${testInfo.project.name}.html`),
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${snapshot.styles}</style></head><body>${snapshot.markup}</body></html>`,
  );
}

async function expectVoiceComposerAccessible(page: Page) {
  const report = await new AxeBuilder({ page })
    .include('.career-expert-composer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(report.violations).toEqual([]);
}

test.describe('B463 voice input', () => {
  test('gets local consent, transcribes into the field, and sends only after review', async ({
    page,
  }, testInfo) => {
    const { getSentTurn, getControl } = await openConsultant(page);
    await page.getByRole('button', { name: 'Голосовой ввод' }).click();
    if (testInfo.project.name === 'mobile-390') {
      await expect(page.locator('.career-expert-panel')).toHaveClass(/is-mobile-expanded/u);
    }
    await expect(page.getByText(/OpenQareer не получает аудиозапись/u)).toBeVisible();
    await expectVoiceComposerAccessible(page);
    await saveEvidence(page, testInfo, 'consent');
    expect((await getControl())?.starts).toBe(0);

    await page.getByRole('button', { name: 'Разрешить микрофон' }).click();
    await expect(page.getByText('Идёт запись')).toBeVisible();
    expect((await getControl())?.lastProcessLocally).toBe(true);
    await saveEvidence(page, testInfo, 'recording');

    await page.getByRole('button', { name: 'Записать снова' }).click();
    await expect(page.getByText('Идёт запись')).toBeVisible();
    await expect.poll(async () => (await getControl())?.starts).toBe(2);
    await expectVoiceComposerAccessible(page);

    await page.evaluate(() => {
      (window as Window & { __voiceTestControl?: VoiceTestControl }).__voiceTestControl?.transcribe(
        'Я собрал команду и объяснил план.',
      );
    });
    await expect(page.locator('#career-expert-input')).toHaveValue(
      'Я собрал команду и объяснил план.',
    );
    expect(getSentTurn()).toBeNull();

    await page.getByRole('button', { name: 'Закончить запись' }).click();
    await expect(
      page.getByText('Текст распознан. Проверьте его в поле ввода перед отправкой.'),
    ).toBeVisible();
    await expectVoiceComposerAccessible(page);
    await saveEvidence(page, testInfo, 'transcribed');
    expect(getSentTurn()).toBeNull();

    await page.getByRole('button', { name: 'Отправить голосом' }).click();
    await expect(page.getByText('Разберём ответ по фактам.')).toBeVisible();
    expect(getSentTurn()).toMatchObject({ content: 'Я собрал команду и объяснил план.' });
    expect(getSentTurn()).not.toHaveProperty('audio');
  });

  test('keeps denial recoverable and the text fallback working', async ({ page }, testInfo) => {
    const { getSentTurn, getControl } = await openConsultant(page);
    await page.getByRole('button', { name: 'Голосовой ввод' }).click();
    await page.getByRole('button', { name: 'Разрешить микрофон' }).click();
    await expect(page.getByText('Идёт запись')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить запись' }).click();
    await expect(page.getByRole('button', { name: 'Голосовой ввод' })).toBeVisible();
    await expect(page.locator('#career-expert-input')).toHaveValue('');

    await page.getByRole('button', { name: 'Голосовой ввод' }).click();
    await page.getByRole('button', { name: 'Разрешить микрофон' }).click();
    await expect(page.getByText('Идёт запись')).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { __voiceTestControl?: VoiceTestControl }).__voiceTestControl?.deny();
    });
    await expect(page.getByText(/Доступ к микрофону не разрешён/u)).toBeVisible();
    await expectVoiceComposerAccessible(page);
    await saveEvidence(page, testInfo, 'denied');
    await page.getByRole('button', { name: 'Как разрешить' }).click();
    await expect(
      page.getByText(/В настройках браузера для этого сайта разрешите микрофон/u),
    ).toBeVisible();
    expect((await getControl())?.starts).toBe(2);
    expect(getSentTurn()).toBeNull();

    await page.getByRole('button', { name: 'Ответить текстом' }).click();
    await page.locator('#career-expert-input').fill('Продолжу текстом.');
    await page.getByRole('button', { name: 'Отправить вопрос' }).click();
    await expect(page.getByText('Разберём ответ по фактам.')).toBeVisible();
    expect(getSentTurn()).toMatchObject({ content: 'Продолжу текстом.' });
  });

  test('does not submit empty speech and offers a new recording', async ({ page }, testInfo) => {
    const { getSentTurn, getControl } = await openConsultant(page);
    await page.getByRole('button', { name: 'Голосовой ввод' }).click();
    await page.getByRole('button', { name: 'Разрешить микрофон' }).click();
    await expect(page.getByText('Идёт запись')).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { __voiceTestControl?: VoiceTestControl }).__voiceTestControl?.deny(
        'no-speech',
      );
    });

    await expect(page.getByText(/Речь не распознана/u)).toBeVisible();
    await expectVoiceComposerAccessible(page);
    await saveEvidence(page, testInfo, 'unrecognized');
    expect(getSentTurn()).toBeNull();
    expect((await getControl())?.starts).toBe(1);

    await page.getByRole('button', { name: 'Записать снова' }).click();
    await expect(
      page.getByText(/Проверим, поддерживает ли браузер локальное распознавание/u),
    ).toBeVisible();
    expect((await getControl())?.starts).toBe(1);
  });

  test('keeps partial recognition editable after an engine error', async ({ page }, testInfo) => {
    const { getSentTurn } = await openConsultant(page);
    await page.getByRole('button', { name: 'Голосовой ввод' }).click();
    await page.getByRole('button', { name: 'Разрешить микрофон' }).click();
    await expect(page.getByText('Идёт запись')).toBeVisible();
    await page.evaluate(() => {
      const control = (window as Window & { __voiceTestControl?: VoiceTestControl })
        .__voiceTestControl;
      control?.transcribe('Предварительный ответ без проверки.');
      control?.deny('network');
    });

    await expect(page.getByText(/Локальное распознавание не завершилось/u)).toBeVisible();
    await expectVoiceComposerAccessible(page);
    await expect(page.getByRole('button', { name: 'Отправить голосом' })).toHaveCount(0);
    await saveEvidence(page, testInfo, 'partial-error');
    expect(getSentTurn()).toBeNull();

    await page.getByRole('button', { name: 'Ответить текстом' }).click();
    const input = page.locator('#career-expert-input');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Предварительный ответ без проверки.');
    await page.getByRole('button', { name: 'Отправить вопрос' }).click();
    await expect(page.getByText('Разберём ответ по фактам.')).toBeVisible();
    expect(getSentTurn()).toMatchObject({ content: 'Предварительный ответ без проверки.' });
  });
});
