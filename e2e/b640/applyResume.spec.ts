import { expect, test, type Page, type Route } from '@playwright/test';
import { expectGates } from './gates';
import { mockResponses } from './responsesFixture';

const claim = (value: string | boolean) => ({
  value,
  memoryId: 'm',
  sourceMessageIds: [],
  reviewFlags: [],
});

function place(
  id: string,
  employer: string,
  title: string,
  start: string,
  end: string | null,
  bullets: string[],
) {
  return {
    id,
    title: claim(title),
    employer: claim(employer),
    location: claim('Москва'),
    startDate: claim(start),
    endDate: end ? claim(end) : null,
    current: claim(!end),
    description: null,
    bullets: bullets.map(claim),
  };
}

/** Те же данные, что в макете o03. */
const DOCUMENT = {
  kind: 'master',
  targetRole: 'Head of Engineering',
  contact: {
    fullName: 'Марина Соколова',
    email: 'm.sokolova@mail.ru',
    phone: '+7 916 245-18-07',
    location: 'Москва',
    links: ['https://linkedin.com/in/msokolova'],
  },
  about: null as string | null,
  experience: [
    place('1', 'Финтех Лаб', 'Руководитель группы разработки', '2021', null, [
      'Команда из 9 человек, 6 из них наняла сама',
      'Релиз раз в 3 дня вместо 2 недель',
      'Перевела платформу на Kubernetes без остановки сервиса, 2024',
      'Вела бэкенд и релизный процесс платформы',
      'Стек команды: Go, Kotlin, PostgreSQL',
    ]),
    place('2', 'Сфера Платежи', 'Руководитель группы бэкенда', '2018', '2021', [
      'Вела бэкенд платёжного шлюза для интернет-магазинов',
      'Отвечала за надёжность шлюза и дежурства группы',
      'Подключала новые способы оплаты по запросам магазинов',
    ]),
    place('3', 'Городские сервисы', 'Ведущий разработчик', '2016', '2018', [
      'Сервис оплаты парковок: от прототипа до 40 тыс. платежей в день',
      'Команда из 4 разработчиков',
    ]),
    place('4', 'Ритейл Тех', 'Разработчик', '2015', '2016', [
      'Мобильный бэкенд программы лояльности',
      'Интеграция с кассами магазинов сети',
    ]),
    place('5', 'Студия Код', 'Младший разработчик', '2014', '2015', [
      'Сайты и интеграции для клиентов студии',
    ]),
  ],
  education: [
    {
      id: 'd',
      institution: claim('МГТУ им. Баумана'),
      qualification: claim('Информатика и системы управления'),
      startDate: null,
      endDate: claim('2014'),
    },
  ],
  skills: ['Kubernetes', 'Go', 'PostgreSQL', 'Kotlin', 'найм и развитие команды'].map((name) => ({
    id: name,
    name,
  })),
  languages: [] as object[],
  unknowns: [],
};

const FULL = {
  ...DOCUMENT,
  about: 'Руковожу платформой 8 лет',
  languages: [{ id: 'l', name: claim('Английский'), cefr: claim('C1') }],
};

async function open(
  page: Page,
  document: object,
  edits = (route: Route) => route.fulfill({ json: { data: { edits: [], lang: 'ru' } } }),
  hhResumes = (route: Route) => route.fulfill({ json: { data: null } }),
) {
  await mockResponses(page);
  await page.route('**/api/v1/candidate/vacancies/*/resume-edits', edits);
  await page.route('**/api/v1/candidate/vacancies/*/letter-approvals/latest', (route) =>
    route.fulfill({ json: { data: { approval: null } } }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/letter-resume', (route) =>
    route.fulfill({ json: { data: { ready: true, versionId: 'v-1' } } }),
  );
  await page.route('**/api/v1/candidate/resume/versions/v-1', (route) =>
    route.fulfill({
      json: {
        data: {
          version: { id: 'v-1', title: 'Head of Engineering', revision: 1, snapshot: { document } },
          currentMasterRevision: 'r',
        },
      },
    }),
  );
  await page.route('**/api/v1/candidate/hh/resumes', hhResumes);
  await page.goto('/app/responses/a-draft/letter?step=resume', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('article', { name: 'Резюме' })).toBeVisible({ timeout: 15_000 });
}

test.describe('B785: шаг «Резюме» по макету o03', () => {
  test('лист, шаблон и скачивание PDF и DOCX', async ({ page }) => {
    const sent: Array<{ format: string; template: string; resume: Record<string, unknown> }> = [];
    await open(page, FULL);
    await page.route('**/api/v1/candidate/resume-builder/export', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ body: 'file', contentType: 'application/octet-stream' });
    });
    const sheet = page.getByRole('article', { name: 'Резюме' });
    await expect(sheet).toContainText('Руковожу платформой 8 лет');
    await expect(sheet).toContainText('Английский (C1)');
    await expect(sheet).toContainText('2021 — сейчас');
    await expectGates(page);
    await page.getByLabel('Шаблон резюме').selectOption('modern');
    await expect(sheet).toHaveClass(/cv-modern/u);
    for (const name of ['PDF', 'DOCX']) {
      await page.getByRole('button', { name: 'Скачать' }).click();
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name }).click();
      expect((await download).suggestedFilename()).toBe(`Марина Соколова.${name.toLowerCase()}`);
      await expect(page.getByRole('button', { name: 'Скачать' })).toBeEnabled();
    }
    expect(sent.map((item) => [item.format, item.template])).toEqual([
      ['pdf', 'modern'],
      ['docx', 'modern'],
    ]);
    expect(sent[0]?.resume).toMatchObject({ about: FULL.about, languages: 'Английский (C1)' });
  });

  test('меню закрывается по Esc, ошибка файла видна', async ({ page }) => {
    await open(page, FULL);
    await page.route('**/api/v1/candidate/resume-builder/export', (route) =>
      route.fulfill({ status: 500, json: { error: { message: 'Сборщик файла занят.' } } }),
    );
    const button = page.getByRole('button', { name: 'Скачать' });
    await button.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'PDF' })).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    await expect(page.getByText('Сборщик файла занят.')).toBeVisible();
  });

  test('правка отменяется, меняется и остаётся в списке; даты без конца', async ({ page }) => {
    const state = {
      cancelled: false,
      text: 'Перевела платформу на Kubernetes без остановки сервиса, 2024',
    };
    const edits = () => [{ id: '1:c', why: 'Kubernetes', ...state }];
    const sent: object[] = [];
    const handler = (route: Route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        sent.push(body);
        if (body.action === 'text') state.text = body.text;
        else state.cancelled = body.action === 'cancel';
      }
      return route.fulfill({ json: { data: { edits: edits(), lang: 'ru' } } });
    };
    const gap = { ...FULL.experience[1]!, endDate: null };
    await open(page, { ...FULL, experience: [FULL.experience[0], gap] }, handler);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Резюме');
    await expect(page.getByRole('heading', { name: '1 правка под эту вакансию' })).toBeVisible();
    await expect(page.getByText('Даты в «Сфера Платежи»')).toHaveCount(1);
    await page.getByText('Что изменено · 1').click();
    await expectGates(page);
    const list = page.getByRole('list', { name: 'Правки под вакансию' });
    await list.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Что изменено · 0')).toBeVisible();
    await list.getByRole('button', { name: 'Вернуть' }).click();
    await list.getByRole('button', { name: 'Изменить' }).click();
    await list.getByLabel('Текст правки').fill('Платформа на Kubernetes');
    await expectGates(page);
    await list.getByRole('button', { name: 'Сохранить' }).click();
    await expect(list).toContainText('Платформа на Kubernetes');
    await expect(page.getByRole('button', { name: 'Одобрить резюме' })).toBeEnabled();
    expect(sent).toHaveLength(3);
  });

  test('«Резюме hh.ru»: прочитанное выбирается, непрочитанное в вебе недоступно', async ({
    page,
  }) => {
    const content = (id: string, title: string) => ({
      id,
      title,
      text: 'x',
      sections: { title, about: '', skills: [], places: [] },
    });
    const lead = content('a', 'Руководитель разработки');
    const go = content('b', 'Ведущий разработчик Go');
    const snapshot = {
      resumes: [...[lead, go].map(({ id, title }) => ({ id, title })), { id: 'c', title: 'CTO' }],
      selected: lead,
      contents: [go],
      readAt: '2026-11-24T00:00:00.000Z',
    };
    await open(page, FULL, undefined, (route) => {
      const put = route.request().method() === 'PUT';
      return route.fulfill({
        json: { data: put ? { ...snapshot, ...route.request().postDataJSON() } : snapshot },
      });
    });
    const select = page.getByLabel('Резюме hh.ru');
    await expect(select).toHaveValue('a');
    await expect(select.locator('option', { hasText: 'CTO' })).toBeDisabled();
    await select.selectOption('b');
    await expect(select).toHaveValue('b');
    await expectGates(page);
  });

  test('RU/EN: сбой оставляет язык, успех показывает английский лист', async ({ page }) => {
    let fails = true;
    let lang = 'ru';
    await open(page, FULL, (route) => {
      if (route.request().method() === 'PUT') {
        if (fails)
          return route.fulfill({
            status: 503,
            json: { error: { code: 'x', message: 'Перевод не собрался. Повторите.' } },
          });
        lang = route.request().postDataJSON().lang;
      }
      return route.fulfill({ json: { data: { edits: [], lang } } });
    });
    const group = page.getByRole('group', { name: 'Язык резюме' });
    const english = group.getByRole('button', { name: 'English' });
    await expect(group.getByRole('button', { name: 'Русский' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await english.click();
    await expect(page.getByText('Перевод не собрался')).toBeVisible();
    await expect(english).toHaveAttribute('aria-pressed', 'false');
    fails = false;
    await english.click();
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Одобрить резюме' })).toBeEnabled();
    await expect(page.getByText('Перевод не собрался')).toBeHidden({ timeout: 15_000 });
    await expectGates(page);
  });

  test('«Одобрить резюме» видна без прокрутки и не закрывает лист', async ({ page }) => {
    await open(page, FULL);
    const button = page.getByRole('button', { name: 'Одобрить резюме' });
    await expect(button).toHaveCount(1);
    const size = page.viewportSize()!;
    if (size.width >= 768) {
      const dock = page.locator('.act-dock.is-auto');
      await expect(dock).toHaveCSS('position', 'sticky');
      const [box, bar, lead] = await Promise.all([
        button.boundingBox(),
        dock.boundingBox(),
        page.locator('.cv-lead').boundingBox(),
      ]);
      expect(Math.abs(bar!.y + bar!.height - size.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.x - lead!.x)).toBeLessThanOrEqual(1);
      await page
        .getByRole('article', { name: 'Резюме' })
        .evaluate((node) => node.scrollIntoView(false));
      await page.mouse.wheel(0, 5_000);
      await expectGates(page);
    } else await expect(page.locator('.act-dock')).toHaveCount(0);
    await button.click();
    await expect(page).toHaveURL(/letter/u);
    await expect(page.locator('.act-dock.is-auto')).toHaveCount(0);
  });
});
