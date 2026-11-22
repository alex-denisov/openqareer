import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { PREP_NOW } from './interviewFixture';
import { mockInterview, type MockInterviewOptions } from './mockInterviewFixture';

async function open(page: Page, options: MockInterviewOptions = {}) {
  await page.clock.setFixedTime(new Date(PREP_NOW));
  const mock = await mockInterview(page, options);
  await page.goto('/app/responses/r-arka/interview/mock', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="i02"]')).toBeVisible({ timeout: 15_000 });
  return mock;
}

/** Браузерное распознавание на устройстве: `__dictate(text)` даёт фразу, `__deny()` — отказ в микрофоне. */
async function fakeRecognition(page: Page) {
  await page.addInitScript(() => {
    type Handler = ((event?: unknown) => void) | undefined;
    class Fake {
      static latest: Fake | undefined;
      static async available() {
        return 'available';
      }
      processLocally = false;
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: Handler;
      onresult: Handler;
      onerror: Handler;
      onend: Handler;
      constructor() {
        Fake.latest = this;
      }
      start() {
        queueMicrotask(() => this.onstart?.());
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    const scope = window as unknown as Record<string, unknown>;
    scope.SpeechRecognition = Fake;
    scope.__dictate = (text: string) => {
      Fake.latest?.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: text } }],
      });
      Fake.latest?.onend?.();
    };
    scope.__deny = () => {
      Fake.latest?.onerror?.({ error: 'not-allowed' });
      Fake.latest?.onend?.();
    };
  });
}

test.describe('B659: «Пробное интервью» (I2)', () => {
  test('B749: микрофон в поле ответа — сказанное дописывается, без доступа кнопка гаснет', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes('390'), 'на 390 значок есть только без доступа');
    await fakeRecognition(page);
    await open(page);
    const field = page.getByLabel('Ваш ответ');
    await field.fill('В 2024 году');
    await page.getByRole('button', { name: 'Надиктовать' }).click();
    await expect(page.getByRole('button', { name: 'Остановить запись' })).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { __dictate: (t: string) => void }).__dictate('мы перевели платформу'),
    );
    await expect(field).toHaveValue(/^В 2024 году.*мы перевели платформу/u);
    await page.getByRole('button', { name: 'Надиктовать' }).click();
    await page.evaluate(() => (window as unknown as { __deny: () => void }).__deny());
    await expect(page.getByRole('button', { name: 'Нет доступа к микрофону' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expectGates(page);
  });

  test('вопрос, ответ, разбор по критериям, «Ответить ещё раз», следующий вопрос и «Закончить»', async ({
    page,
  }) => {
    const mock = await open(page);
    await expect(page.getByText('Пробное интервью · Арка Холдинг · вопрос 1 из 2')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '«Расскажите о самом тяжёлом релизе»' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(page.getByText('Напишите ответ', { exact: true })).toBeVisible();
    await page.getByLabel('Ваш ответ').fill('В 2024 году мы переводили платформу на Kubernetes.');
    await page.getByRole('button', { name: 'Ответить', exact: true }).click();
    const rows = page.locator('ul.mi-crit > li.row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText('Ситуация и ваша роль');
    await expect(rows.first().locator('.tag')).toHaveText('есть');
    await expect(rows.last().locator('.tag')).toHaveText('добавить');
    await expectGates(page);
    await page.getByRole('button', { name: 'Ответить ещё раз' }).click();
    await page.getByLabel('Ваш ответ').fill('Сократили релиз с 4 часов до 20 минут.');
    await page.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(rows).toHaveCount(4);
    await page.getByRole('button', { name: 'Следующий вопрос' }).click();
    await expect(page.getByText('вопрос 2 из 2')).toBeVisible();
    await expect(page.getByLabel('Ваш ответ')).toHaveValue('');
    await page.getByRole('button', { name: 'Закончить' }).click();
    await expect(page.locator('[data-b640-node="i01"]')).toBeVisible();
    expect(mock.calls).toEqual([
      'start',
      'answer q-release replace=false',
      'answer q-release replace=true',
      'next s-1',
      'finish s-1',
    ]);
  });

  test('тариф без пробных интервью: одна строка и путь к тарифам', async ({ page }) => {
    await open(page, { paywall: true });
    await expect(page.getByText('Пробное интервью — на платном тарифе.')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Тарифы' })).toHaveAttribute(
      'href',
      '/app/tariffs',
    );
  });

  test('не закончено интервью по другому отклику: закончить его и начать это', async ({ page }) => {
    const mock = await open(page, { otherSession: true });
    await expect(page.getByText('Не закончено пробное интервью «Head of Platform».')).toBeVisible();
    await page.getByRole('button', { name: 'Закончить его и начать это' }).click();
    await expect(page.getByText('Пробное интервью · Арка Холдинг · вопрос 1 из 2')).toBeVisible();
    expect(mock.calls).toEqual(['finish s-old', 'start']);
  });
});
