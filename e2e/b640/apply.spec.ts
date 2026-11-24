import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { expectLastActionReachable } from './lastActionReachable';
import { installDesktopApiTestBridge } from '../../scripts/desktop-api-test-bridge.mjs';
import { mockResponses, type ResponsesMockOptions } from './responsesFixture';

const SHOTS = process.env.B640_SHOTS;
const LETTER =
  'Здравствуйте!\n\nЗа пять лет я вырастила группу разработки с 3 до 9 человек.\n\nМарина Соколова';

interface ApplyMock {
  readonly calls: string[];
}

interface ApplyOptions extends ResponsesMockOptions {
  /** Сколько раз письмо не собирается, прежде чем собраться. */
  readonly failPitch?: number;
  /** Письмо отвечает «отклики закончились». */
  readonly quotaExhausted?: boolean;
  /** Сервер нашёл знакомого в компании. */
  readonly withPath?: boolean;
  /** У вакансии есть анкета работодателя. */
  readonly questionnaire?: boolean;
  /** Длинный список стран, как у настоящих анкет Greenhouse (B641). */
  readonly longChoice?: boolean;
  /** Письмо уже одобрено: сервер отдаёт одобрение с этим текстом. */
  readonly approvedBody?: string;
  /** Длинный текст вакансии, как у настоящих на hh.ru (B645). */
  readonly longVacancy?: boolean;
}

function circles(vacancyId: string, withPath: boolean) {
  const anna = { id: 'anna', fullName: 'Анна Ветрова', roleTitle: 'HRD', companyName: 'Гринкод' };
  return {
    vacancyId,
    companyKey: 'grinkod',
    companyName: 'Гринкод',
    vacancyTitle: 'Head of Engineering',
    circles: [
      {
        circle: 1,
        state: withPath ? 'available' : 'none',
        message: '',
        paths: withPath
          ? [
              {
                id: 'path-anna',
                circle: 1,
                path: [
                  { id: 'me', fullName: 'Марина Соколова', roleTitle: null, companyName: null },
                  anna,
                ],
                recipient: anna,
                evidence: [],
                strength: 'direct',
                source: 'manual',
                nextStep: 'write',
              },
            ]
          : [],
      },
      { circle: 2, state: 'none', message: '', paths: [] },
      { circle: 3, state: 'available', message: '', paths: [] },
    ],
    resume: { available: true, kind: 'master' },
    linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
  };
}

/** Заглушки механик единого отклика поверх заглушек раздела «Отклики». */
async function mockApply(page: Page, options: ApplyOptions = {}): Promise<ApplyMock> {
  const calls: string[] = [];
  let failPitch = options.failPitch ?? 0;
  await mockResponses(page, options);
  const vacancyOf = (url: string) =>
    decodeURIComponent(new URL(url).pathname.split('/').at(-2) ?? '');

  await page.route('**/api/v1/candidate/vacancies/*/connection-circles', (route) =>
    route.fulfill({
      json: { data: circles(vacancyOf(route.request().url()), options.withPath === true) },
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/detail', (route) =>
    route.fulfill({
      json: {
        data: {
          id: vacancyOf(route.request().url()),
          description: options.longVacancy
            ? Array.from({ length: 80 }, (_, i) => `Пункт ${i + 1}: задачи и требования.`).join(
                '\n',
              )
            : 'Ищем руководителя для 3 команд платформы.\nЗадачи: переход на Kubernetes.',
          truncated: false,
          skills: [],
          responsibilities: [],
        },
      },
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/pitch', async (route) => {
    const body = route.request().postDataJSON() as { tone?: string; recipient?: { name?: string } };
    calls.push(`pitch ${body.tone ?? ''} ${body.recipient?.name ?? ''}`.trim());
    if (options.quotaExhausted) {
      await route.fulfill({
        status: 402,
        json: { error: { code: 'quota_exhausted', message: 'Отклики закончились.' } },
      });
      return;
    }
    if (failPitch > 0) {
      failPitch -= 1;
      await route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Сбой' } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          vacancyId: vacancyOf(route.request().url()),
          emailPitch: { subject: 'Отклик', body: LETTER },
          linkedInNote: LETTER,
          contactMessage: LETTER,
          atsCoverLetter: LETTER,
          usedEvidenceIds: [],
          language: 'ru',
          resumeAvailable: true,
          resumeKind: 'master',
          generatedAt: new Date().toISOString(),
        },
      },
    });
  });
  if (options.quotaExhausted) {
    await page.route('**/api/v1/candidate/billing/quotas', (route) =>
      route.fulfill({
        json: {
          data: {
            plan: 'free',
            unlimited: false,
            period: null,
            quotas: [
              {
                key: 'applications',
                label: 'Отклики',
                limit: 20,
                used: 20,
                remaining: 0,
                upgradePlan: 'basic',
              },
            ],
            fitPercentLimit: null,
          },
        },
      }),
    );
    await page.route('**/api/v1/candidate/applications/funnel', (route) =>
      route.fulfill({
        json: {
          data: {
            saved: 1,
            applied: 15,
            responded: 3,
            interview: 1,
            offer: 0,
            rejected: 1,
            archived: 0,
            opened: 0,
          },
        },
      }),
    );
  }
  const variants: Record<string, unknown>[] = [];
  await page.route('**/api/v1/candidate/text-variants**', (route) =>
    route.fulfill({ json: { data: { variants, remaining: 3 - variants.length } } }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/pitch/variants', async (route) => {
    const body = route.request().postDataJSON() as { wish: { chips: string[]; text: string } };
    calls.push(`variant ${body.wish.chips.join(',')} ${body.wish.text}`.trim());
    if (variants.length >= 3) {
      await route.fulfill({
        status: 409,
        json: { error: { code: 'variant_limit_reached', message: 'Лимит' } },
      });
      return;
    }
    const text = `Здравствуйте!\n\nДругой вариант письма, короче.\n\nМарина Соколова — ${variants.length + 1}`;
    const variant = {
      id: `variant-${variants.length + 1}`,
      position: variants.length + 1,
      text,
      wish: body.wish,
      createdAt: new Date().toISOString(),
      payload: {
        emailPitch: { subject: 'Отклик', body: text },
        usedEvidenceIds: [`fact-v${variants.length + 1}`],
      },
    };
    variants.push(variant);
    await route.fulfill({
      status: 201,
      json: { data: { variant, variants, remaining: 3 - variants.length } },
    });
  });
  const formAnswers: { questionId: string; text: string }[] = [];
  let formSubmittedAt: string | null = null;
  const formView = (vacancyId: string) => {
    const questions = [
      { id: 'q1', text: 'Сколько человек было в вашей команде?', required: true, kind: 'text' },
      { id: 'q2', text: 'Ожидаемый уровень дохода?', required: true, kind: 'text' },
      { id: 'q3', text: 'Готовы ли к командировкам?', required: false, kind: 'text' },
      { id: 'q4', text: 'LinkedIn Profile', required: true, kind: 'text' },
      {
        id: 'q5',
        text: 'Country of residence',
        required: true,
        kind: 'choice',
        options: options.longChoice
          ? Array.from({ length: 255 }, (_, index) => `Country ${index}`)
          : ['Germany', 'Россия', 'Other'],
      },
    ];
    // Ответы из профиля сервер отдаёт уже подставленными, пока кандидат не сохранил свои.
    const fromProfile = [
      { questionId: 'q2', text: 'от 500 000 ₽', source: 'Ожидания из вашего профиля' },
      {
        questionId: 'q4',
        text: 'https://www.linkedin.com/in/msokolova',
        source: 'Из контактов вашего профиля',
      },
      { questionId: 'q5', text: 'Россия', source: 'Из контактов вашего профиля' },
    ];
    // Стёртый ответ хранится пустым: из профиля он больше не подставляется.
    const shown = [
      ...formAnswers.filter((answer) => answer.text),
      ...fromProfile
        .filter((item) => !formAnswers.some((answer) => answer.questionId === item.questionId))
        .map((item) => ({ questionId: item.questionId, text: item.text })),
    ];
    return {
      vacancyId,
      state: options.questionnaire ? 'ready' : 'none',
      formUrl: options.questionnaire ? 'https://boards.greenhouse.io/grinkod/jobs/77' : null,
      questions: options.questionnaire ? questions : [],
      vacancyTitle: 'Head of Engineering',
      vacancyCompany: 'Гринкод',
      answers: options.questionnaire ? shown : [],
      suggestions: fromProfile.filter((item) =>
        shown.some((answer) => answer.questionId === item.questionId && answer.text === item.text),
      ),
      answered: shown.length,
      total: options.questionnaire ? questions.length : 0,
      missingRequired: 0,
      readAt: null,
      submittedAt: formSubmittedAt,
    };
  };
  await page.route('**/api/v1/candidate/vacancies/*/questionnaire**', async (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const vacancyId = decodeURIComponent(parts[parts.indexOf('vacancies') + 1] ?? '');
    const method = route.request().method();
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { answers: typeof formAnswers };
      formAnswers.splice(0, formAnswers.length, ...body.answers);
      calls.push(`answers ${body.answers.map((answer) => answer.questionId).join(',')}`);
      for (const answer of body.answers)
        if (!answer.text) calls.push(`cleared ${answer.questionId}`);
    }
    if (method === 'POST') {
      formSubmittedAt = new Date().toISOString();
      calls.push('form submitted');
      await route.fulfill({ json: { data: { submittedAt: formSubmittedAt } } });
      return;
    }
    await route.fulfill({ json: { data: formView(vacancyId) } });
  });
  await page.route('**/api/v1/candidate/vacancies/*/letter-approvals/latest', async (route) => {
    calls.push('approval read');
    const approved = options.approvedBody
      ? {
          applicationId: 'a-draft',
          documentId: 'doc-1',
          approvedAt: '2026-11-19T10:00:00.000Z',
          status: 'approved',
          sent: false,
          resume: null,
          subject: null,
          body: options.approvedBody,
          variantId: null,
        }
      : null;
    await route.fulfill({ json: { data: { approval: approved } } });
  });
  await page.route('**/api/v1/candidate/vacancies/*/letter-resume', (route) =>
    route.fulfill({ json: { data: { ready: false } } }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/letter-approvals', async (route) => {
    const body = route.request().postDataJSON() as {
      body: string;
      tone: string;
      usedEvidenceIds: readonly string[];
    };
    calls.push(`approve ${body.tone}`);
    calls.push(`facts ${body.usedEvidenceIds.join(',')}`);
    calls.push(`body ${body.body}`);
    await route.fulfill({
      json: {
        data: {
          applicationId: 'a-draft',
          documentId: 'doc-1',
          approvedAt: new Date().toISOString(),
          status: 'approved',
          sent: false,
          resume: null,
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/vacancy-applications', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: { data: [] } });
      return;
    }
    const body = route.request().postDataJSON() as { clusterId: string; status: string };
    calls.push(`sent ${body.clusterId} ${body.status}`);
    await route.fulfill({
      json: {
        data: {
          clusterId: body.clusterId,
          status: body.status,
          vacancy: { title: '', company: '', url: '', source: 'hh' },
          openedAt: null,
          appliedAt: new Date().toISOString(),
        },
      },
    });
  });
  return { calls };
}

async function open(page: Page, path: string, options: ApplyOptions = {}): Promise<ApplyMock> {
  const mock = await mockApply(page, options);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="o02"]')).toBeVisible({ timeout: 15_000 });
  return mock;
}

const step = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Отклик' }).getByRole('link', { name });

test.describe('B657: единый экран отклика', () => {
  test('длинный текст вакансии прокручивается внутри и не растягивает страницу (B645)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'проверка первого экрана ноутбука');
    await page.setViewportSize({ width: 1440, height: 790 });
    await open(page, '/app/responses/a-draft/letter', { longVacancy: true });
    const text = page.getByRole('region', { name: 'Текст вакансии' });
    await expect(text).toBeVisible();
    const box = await text.boundingBox();
    expect(box?.height ?? 9999).toBeLessThanOrEqual(790);
    const scrolls = await text.evaluate((node) => node.scrollHeight > node.clientHeight);
    expect(scrolls).toBe(true);
    const approve = await page.getByRole('button', { name: 'Одобрить' }).boundingBox();
    expect((approve?.y ?? 9999) + (approve?.height ?? 0)).toBeLessThanOrEqual(790);
  });

  test('письмо: текст вакансии, тон, одобрение, отправка и «Я откликнулся»', async ({ page }) => {
    const mock = await open(page, '/app/responses/a-draft/letter');
    await expect(page.getByRole('heading', { name: 'Проверьте письмо' })).toBeVisible();
    await expect(page.getByLabel('Текст письма')).toHaveValue(/вырастила группу разработки/u);
    await expect(step(page, 'Письмо')).toHaveAttribute('aria-current', 'page');
    await expectGates(page);

    await page.locator('.ls-chip summary').click();
    await page.getByLabel('Тон').selectOption('confident');
    await expect
      .poll(() => mock.calls.filter((call) => call.startsWith('pitch confident')).length)
      .toBe(1);
    await page.getByRole('button', { name: 'Одобрить' }).click();
    await expect(page.getByText('Письмо одобрено').first()).toBeVisible();
    expect(mock.calls).toContain('approve confident');
    await expect(page.getByLabel('Тон')).toBeDisabled();
    await expect(page.getByLabel('Текст письма')).toHaveAttribute('readonly', '');

    await page.getByRole('button', { name: 'К отправке' }).click();
    await expect(page.getByRole('heading', { name: 'Отправьте отклик с hh.ru' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть вакансию на сайте' })).toHaveAttribute(
      'href',
      'https://hh.ru/vacancy/1',
    );
    await expect(page.locator('.cb-t')).toContainText('вырастила группу разработки');
    const copy = (await page.locator('.cb-copy').first().boundingBox())!;
    expect([copy.width, copy.height]).toEqual([44, 44]);
    await expectGates(page);
    await page.getByRole('button', { name: 'Я откликнулся' }).click();
    await expect(page.getByText('Отклик отмечен как отправленный')).toBeVisible();
    expect(mock.calls).toContain('sent cluster-a-draft applied');
    await expect(page.getByRole('link', { name: 'К отклику' })).toHaveAttribute(
      'href',
      '/app/responses/a-draft',
    );
  });

  test('одобренное письмо открывается своим текстом без новой сборки черновика', async ({
    page,
  }) => {
    const body = 'Одобренный текст письма для Гринкода.';
    const mock = await open(page, '/app/responses/a-draft/letter', { approvedBody: body });
    await expect(page.getByRole('heading', { name: 'Письмо одобрено' })).toBeVisible();
    await expect(page.getByLabel('Текст письма')).toHaveValue(body);
    await expect(page.getByText('Собираем письмо…')).toHaveCount(0);
    expect(mock.calls).toContain('approval read');
    expect(mock.calls.filter((call) => call.startsWith('pitch'))).toEqual([]);
  });

  test('«Изменить письмо», а черновик не собрался — одобренный текст остаётся в поле (B724)', async ({
    page,
  }) => {
    const body = 'Одобренный текст письма для Гринкода.';
    const mock = await open(page, '/app/responses/a-draft/letter', {
      approvedBody: body,
      failPitch: 1,
    });
    await page.getByRole('button', { name: 'Изменить письмо' }).click();
    await expect.poll(() => mock.calls.filter((call) => call.startsWith('pitch')).length).toBe(1);
    await expect(page.getByText('Письмо не собралось')).toBeVisible();
    await expect(page.getByLabel('Текст письма')).toHaveValue(body);
    await expect(page.getByText('Собираем письмо…')).toHaveCount(0);
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Письмо не собралось')).toHaveCount(0);
    await expect(page.getByLabel('Текст письма')).toHaveValue(body);
  });

  test('путь с шапкой контекста: на 390 скрыт, шаги под верхней полосой (B721)', async ({
    page,
  }, testInfo) => {
    await open(page, '/app/responses/a-draft/letter');
    const crumbs = page.getByRole('navigation', { name: 'Путь' });
    const steps = page.getByRole('navigation', { name: 'Отклик' });
    if (testInfo.project.name === 'mobile-390') {
      await expect(crumbs).toBeHidden();
      // Макет o02/o06a на 390: шаги сразу под верхней полосой (y44), строки пути нет.
      expect((await steps.boundingBox())?.y).toBe(44);
    } else {
      await expect(crumbs).toBeVisible();
    }
  });

  test('вход по id вакансии без карточки отклика', async ({ page }) => {
    await open(page, '/app/responses/cluster-from-list/letter');
    await expect(page.getByLabel('Текст письма')).toHaveValue(/Здравствуйте/u);
    await expect(page.getByLabel('Текст вакансии')).toContainText('переход на Kubernetes');
    await expect(page.locator('.ctx-title').first()).toContainText('Head of Engineering · Гринкод');
  });

  test('письмо через знакомого: адресат меняет письмо', async ({ page }) => {
    const mock = await open(page, '/app/responses/a-draft/letter', { withPath: true });
    await expect(page.getByLabel('Текст письма')).toHaveValue(/Здравствуйте/u);
    await page.getByLabel('Кому').selectOption({ label: 'Анна Ветрова · знакомый' });
    await expect.poll(() => mock.calls.some((call) => call.includes('Анна Ветрова'))).toBe(true);
  });

  test('письмо не собралось: ошибка на месте и «Повторить»', async ({ page }) => {
    await open(page, '/app/responses/a-draft/letter', { failPitch: 1 });
    await expect(page.getByRole('alert')).toContainText('Письмо не собралось');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByLabel('Текст письма')).toHaveValue(/Здравствуйте/u);
  });

  test('отклики закончились: следующий тариф и «Отложить»', async ({ page }) => {
    await open(page, '/app/responses/a-draft/letter', { quotaExhausted: true, plan: 'free' });
    await expect(page.getByRole('heading', { name: 'Отклики закончились' })).toBeVisible();
    await expect(page.getByText('20 откликов → 5 ответов → 1 интервью')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Перейти на Basic' })).toHaveAttribute(
      'href',
      '/app/account/billing',
    );
    await expect(page.getByRole('link', { name: 'Отложить' })).toHaveAttribute(
      'href',
      '/app/responses',
    );
    await expectGates(page);
  });

  test('резюме: шаг открывается по адресу, без опыта ведёт в профиль', async ({ page }) => {
    await open(page, '/app/responses/a-draft/letter?step=resume');
    await expect(step(page, 'Резюме')).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('heading', { name: 'Резюме пока не из чего собрать' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть профиль' })).toHaveAttribute(
      'href',
      '/app/profile',
    );
    await expectGates(page);
  });

  test('другой вариант: правка хранится у своего текста, в одобрение идут его факты', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/a-draft/letter');
    const letter = page.getByLabel('Текст письма');
    await expect(letter).toHaveValue(/вырастила группу разработки/u);
    await letter.fill('Первое письмо, моя правка');
    await page.getByRole('button', { name: /Другой вариант · 3/u }).click();
    await page
      .getByRole('dialog', { name: 'Что поменять' })
      .getByRole('button', { name: 'Сделать вариант' })
      .click();
    await expect(letter).toHaveValue(/Другой вариант письма, короче/u);
    await letter.fill('Вариант, моя правка');
    const pager = page.getByRole('group', { name: 'Варианты письма' });
    await pager.getByRole('button', { name: 'Предыдущий вариант' }).click();
    await expect(letter).toHaveValue('Первое письмо, моя правка');
    await pager.getByRole('button', { name: 'Следующий вариант' }).click();
    await expect(letter).toHaveValue('Вариант, моя правка');

    await page.getByRole('button', { name: 'Одобрить' }).click();
    await expect(page.getByText('Письмо одобрено').first()).toBeVisible();
    expect(mock.calls).toContain('facts fact-v1');
    expect(mock.calls).toContain('body Вариант, моя правка');
  });

  test('другой вариант: пожелание, листание, предел в три', async ({ page }) => {
    const mock = await open(page, '/app/responses/a-draft/letter');
    const letter = page.getByLabel('Текст письма');
    await expect(letter).toHaveValue(/вырастила группу разработки/u);
    await expect(page.getByRole('group', { name: 'Варианты письма' })).toHaveCount(0);

    await page.getByRole('button', { name: /Другой вариант · 3/u }).click();
    const pop = page.getByRole('dialog', { name: 'Что поменять' });
    await expect(pop).toBeVisible();
    await expectGates(page, { only: ['modal_fit', 'field_height'] });
    await expect(pop.getByLabel('Своё пожелание')).toHaveCSS('padding-left', '12px');
    await pop.getByRole('button', { name: 'Короче' }).click();
    await pop.getByLabel('Своё пожелание').fill('начать с результата');
    await pop.getByRole('button', { name: 'Сделать вариант' }).click();
    await expect(pop).toHaveCount(0);
    await expect(letter).toHaveValue(/Другой вариант письма, короче/u);
    expect(mock.calls).toContain('variant shorter начать с результата');

    const pager = page.getByRole('group', { name: 'Варианты письма' });
    await expect(pager).toContainText('2 из 2');
    await pager.getByRole('button', { name: 'Предыдущий вариант' }).click();
    await expect(letter).toHaveValue(/вырастила группу разработки/u);
    await expect(pager).toContainText('1 из 2');
    await expect(page.getByRole('button', { name: /Другой вариант · 2/u })).toBeVisible();

    for (const left of [2, 1]) {
      await page.getByRole('button', { name: new RegExp(`Другой вариант · ${left}`, 'u') }).click();
      await page
        .getByRole('dialog', { name: 'Что поменять' })
        .getByRole('button', { name: 'Сделать вариант' })
        .click();
      await expect(pager).toContainText(`${5 - left} из ${5 - left}`);
    }
    await expect(page.getByRole('button', { name: /Другой вариант/u })).toHaveCount(0);
    await expectGates(page);

    await page.getByRole('button', { name: 'Одобрить' }).click();
    await expect(page.getByText('Письмо одобрено').first()).toBeVisible();
    await expect(pager).toHaveCount(0);
  });

  test('«Что поменять» закрывается по Esc и «Отмена»', async ({ page }) => {
    await open(page, '/app/responses/a-draft/letter');
    await page.getByRole('button', { name: /Другой вариант/u }).click();
    await expect(page.getByRole('dialog', { name: 'Что поменять' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Что поменять' })).toHaveCount(0);
    await page.getByRole('button', { name: /Другой вариант/u }).click();
    await page
      .getByRole('dialog', { name: 'Что поменять' })
      .getByRole('button', { name: 'Отмена' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Что поменять' })).toHaveCount(0);
  });

  test('анкета работодателя: ответы, подсказка из профиля, копирование и отметка', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/a-draft/letter?step=form', {
      questionnaire: true,
    });
    await expect(step(page, 'Анкета')).toHaveAttribute('aria-current', 'page');
    // Ответы из профиля уже подставлены: доход, ссылка и страна; выбор — из вариантов работодателя.
    await expect(page.getByRole('heading', { name: '3 ответа из 5 готовы' })).toBeVisible();
    await expect(page.getByLabel('Ваш ответ: Ожидаемый уровень дохода?')).toHaveValue(
      'от 500 000 ₽',
    );
    await expect(page.getByLabel('Ваш ответ: LinkedIn Profile')).toHaveValue(
      'https://www.linkedin.com/in/msokolova',
    );
    // B703: вопрос с выбором — переключатели вариантов работодателя, а не поле.
    const country = page.getByRole('radiogroup', { name: 'Ваш ответ: Country of residence' });
    await expect(country.getByRole('radio')).toHaveCount(3);
    await expect(country.getByRole('radio', { name: 'Россия' })).toBeChecked();
    await expect(country.locator('select')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Откуда ответ' })).toHaveCount(3);
    await expect(page.getByText('необязательный')).toHaveCount(1);
    await expectGates(page);

    const first = page.getByLabel('Ваш ответ: Сколько человек было в вашей команде?');
    await first.fill('9 человек');
    await first.blur();
    await expect.poll(() => mock.calls.some((call) => /^answers .*q1/u.test(call))).toBe(true);
    await expect(page.getByRole('heading', { name: '4 ответа из 5 готовы' })).toBeVisible();
    await country.getByRole('radio', { name: 'Germany' }).check();
    await expect.poll(() => mock.calls.some((call) => call.includes('q5'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Откуда ответ' })).toHaveCount(2);
    // Стёртый ответ из профиля уходит на сервер пустым и после перезагрузки не возвращается.
    const salary = page.getByLabel('Ваш ответ: Ожидаемый уровень дохода?');
    await salary.fill('');
    await salary.blur();
    await expect.poll(() => mock.calls.includes('cleared q2')).toBe(true);
    await page.reload();
    await expect(page.getByLabel('Ваш ответ: Ожидаемый уровень дохода?')).toHaveValue('');
    await expect(page.getByLabel('Ваш ответ: LinkedIn Profile')).toHaveValue(
      'https://www.linkedin.com/in/msokolova',
    );
    // На 390 боковая панель скрыта: та же ссылка стоит в блоке действий под вопросами.
    await expect(
      page.getByRole('link', { name: 'Анкета на сайте ↗' }).locator('visible=true').first(),
    ).toHaveAttribute('href', 'https://boards.greenhouse.io/grinkod/jobs/77');
    await page.getByRole('button', { name: 'Анкета отправлена' }).click();
    await expect(page.getByText('Анкета отмечена как отправленная')).toBeVisible();
    expect(mock.calls).toContain('form submitted');
  });

  test('B641: длинный список стран — поиск, «Показать ещё», цели 44 px', async ({ page }) => {
    const mock = await open(page, '/app/responses/a-draft/letter?step=form', {
      questionnaire: true,
      longChoice: true,
    });
    const country = page.getByRole('radiogroup', { name: 'Ваш ответ: Country of residence' });
    // 20 вариантов страницы и сохранённый ответ вне списка.
    await expect(country.getByRole('radio')).toHaveCount(21);
    const search = page.getByRole('searchbox', { name: /Найти вариант/u });
    const more = page.getByRole('button', { name: 'Показать ещё' });
    for (const target of [search, more, country.locator('label').first()]) {
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expectGates(page);
    await more.click();
    await expect(country.getByRole('radio')).toHaveCount(41);
    await search.fill('country 254');
    await country.getByRole('radio', { name: 'Country 254' }).check();
    await expect(country.getByRole('radio')).toHaveCount(1);
    await expect.poll(() => mock.calls.some((call) => call.includes('q5'))).toBe(true);
    await search.fill('zzz');
    await expect(page.getByText('Ничего не нашлось')).toBeVisible();
  });

  test('без анкеты вкладки «Анкета» нет, адрес шага ведёт к письму', async ({ page }) => {
    await open(page, '/app/responses/a-draft/letter?step=form');
    await expect(page.getByRole('heading', { name: 'Проверьте письмо' })).toBeVisible();
    await expect(step(page, 'Анкета')).toHaveCount(0);
  });

  test('B704 в приложении: окна hh.ru нет — выбор резюме ведёт ко входу, не к ошибке', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'приложение только на компьютере');
    await page.addInitScript(installDesktopApiTestBridge);
    await page.addInitScript(() => {
      localStorage.setItem('openqareer_session_token', 'desktop-e2e-session');
      const calls: string[] = [];
      (window as unknown as { __hhCalls: string[] }).__hhCalls = calls;
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {
          invoke: (command: string, args?: { url?: string }) => {
            calls.push(args?.url ? `${command} ${args.url}` : command);
            // Ровно так отвечает Rust (`inspect_session_page_for`), когда окна сессии hh.ru нет.
            if (command === 'inspect_connector_session_page')
              return Promise.reject('session_window_missing');
            if (command === 'open_connector_session') {
              return Promise.resolve({ opened: true, label: 'connector-hh', reason: null });
            }
            return Promise.resolve(null);
          },
        };
    });
    await page.route('**/api/v1/candidate/hh/resumes', (route) =>
      route.fulfill({ json: { data: null } }),
    );
    await open(page, '/app/responses/a-draft/letter');
    await page.getByRole('button', { name: 'Одобрить' }).click();
    await page.getByRole('button', { name: 'К отправке' }).click();
    await expect(
      page.getByRole('heading', { name: 'Всё одобрено — можно отправлять' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отправить отклик' })).toBeDisabled();

    await page.getByRole('button', { name: 'Выбрать резюме' }).click();
    const sheet = page.getByRole('dialog', { name: 'Каким резюме откликаться' });
    await expect(sheet.getByText('Нужен вход в hh.ru')).toBeVisible();
    await expect(sheet.getByText('не прочитался')).toHaveCount(0);
    const retry = sheet.getByRole('button', { name: 'Прочитать снова' });
    const box = await retry.boundingBox();
    expect(box && box.width > box.height).toBe(true);
    expect(box!.height).toBeLessThan(80);
    await expectGates(page);

    await sheet.getByRole('button', { name: 'Войти в hh.ru' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __hhCalls: string[] }).__hhCalls))
      .toContain('open_connector_session');
  });

  test('B678 в приложении: строки отправки и разбор резюме hh.ru — по макету', async ({ page }) => {
    await page.addInitScript(installDesktopApiTestBridge);
    await page.addInitScript(() => {
      localStorage.setItem('openqareer_session_token', 'desktop-e2e-session');
      const list =
        '<a href="/resume/abc1">Руководитель разработки</a><a href="/resume/abc2">Ведущий разработчик Go</a>';
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {
          invoke: (command: string, args?: { request?: { url?: string } }) => {
            if (command === 'inspect_connector_session_page')
              return Promise.resolve({
                ready: true,
                url: 'https://hh.ru/applicant/resumes',
                signedInApplicant: true,
                login: false,
                otp: false,
                captcha: false,
              });
            if (command === 'read_connector_session_page')
              return Promise.resolve({
                ok: true,
                url: args?.request?.url,
                body: args?.request?.url?.includes('/resume/')
                  ? '<div data-qa="resume-block-title-position">Руководитель</div>'
                  : list,
              });
            return Promise.resolve(null);
          },
        };
    });
    // Общая заглушка API ставится в open: маршруты hh.ru — после неё.
    await open(page, '/app/responses/a-draft/letter');
    const selected = {
      id: 'abc1',
      title: 'Руководитель разработки',
      text: 'Опыт',
      sections: { title: 'Руководитель', about: '', skills: [], places: [] },
    };
    const snapshot = { resumes: [{ id: 'abc1', title: selected.title }], selected, readAt: 'x' };
    await page.route('**/api/v1/candidate/hh/resumes', (route) =>
      route.fulfill({ json: { data: snapshot } }),
    );
    await page.route('**/api/v1/candidate/hh/resumes/edits**', (route) =>
      route.fulfill({
        json: {
          data: {
            resumeId: 'abc1',
            vacancyId: 'v',
            edits: [
              { id: 'title', section: 'title', was: 'Руководитель', now: 'Head of Engineering' },
              { id: 'about', section: 'about', was: 'Руковожу 5 лет.', now: 'Пять лет руковожу.' },
            ],
          },
        },
      }),
    );
    await page.route('**/api/v1/candidate/hh/resumes/review**', (route) =>
      route.fulfill({
        json: {
          data: {
            vacancyId: 'v',
            requirements: [],
            recommendedId: null,
            resumes: ['abc1', 'abc2'].map((resumeId, index) => ({
              resumeId,
              title: '',
              status: 'fits',
              matched: [],
              missing: [],
              editCount: index ? 0 : 2,
            })),
          },
        },
      }),
    );
    await page.getByRole('button', { name: 'Одобрить' }).click();
    await page.getByRole('button', { name: 'К отправке' }).click();

    const rows = page.locator('.ap-parts > li.row');
    await expect(rows).toHaveCount(2);
    await expect(rows.last().locator('.tag')).toBeVisible();
    for (const row of await rows.all()) {
      const box = (await row.boundingBox())!;
      const tag = (await row.locator('> .tag').boundingBox())!;
      expect(Math.abs(box.x + box.width - tag.x - tag.width)).toBeLessThan(1.5);
    }
    await expect(rows.first()).toHaveCSS('border-bottom-width', '1px');
    await expectLastActionReachable(page);
    await page.getByRole('button', { name: /^Письмо · одобрено/u }).click();
    await expect(page.getByLabel('Текст письма')).toBeVisible();
    await page.getByRole('button', { name: 'К отправке' }).click();

    await page.getByRole('button', { name: 'Резюме hh.ru «Руководитель разработки»' }).click();
    const next = page.getByRole('dialog').getByRole('button', { name: 'Продолжить' });
    await expect(next.locator('svg')).toHaveCount(1, { timeout: 15_000 });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '2 правки' }).click();
    const applyAll = page.getByRole('button', { name: 'Применить все на hh.ru' });
    await expect(page.getByRole('radio', { name: 'Руководитель разработки' })).toBeChecked();
    await expect(applyAll).toBeInViewport();
    const section = (await page.locator('.hh2-sec').first().boundingBox())!;
    const main = (await page.locator('.page.two').boundingBox())!;
    expect(section.width).toBeGreaterThan(main.width * 0.85);
    await expectLastActionReachable(page);
    await expectGates(page);
  });

  test('отправка без одобренного письма возвращает к письму', async ({ page }) => {
    await open(page, '/app/responses/a-draft/letter?step=send');
    await expect(page.getByRole('heading', { name: 'Сначала одобрите письмо' })).toBeVisible();
    await page.getByRole('button', { name: 'К письму' }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте письмо' })).toBeVisible();
  });

  test('снимки единого отклика для сверки с макетами', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    const widths = desktop ? [1440, 1176] : [390];
    await mockApply(page);
    await page.goto('/app/responses/a-draft/letter', { waitUntil: 'domcontentloaded' });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto('/app/responses/a-draft/letter', { waitUntil: 'domcontentloaded' });
      await expect(page.getByLabel('Текст письма')).toHaveValue(/Здравствуйте/u);
      for (const width of widths) {
        await page.setViewportSize({ width, height: desktop ? 900 : 844 });
        await page.screenshot({
          path: `.s13-shots/o02-pismo-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  });
});
