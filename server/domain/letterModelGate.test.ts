import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reviewLetterBody, type LetterGateSources } from './letterModelGate';

const fixtures = join(__dirname, 'fixtures', 'letterAccepted');
const read = (name: string) => readFileSync(join(fixtures, name), 'utf8');

/** Письма run-15 и настоящий профиль: их принял владелец 06.11, проверка не должна их отклонять. */
const OWNER: LetterGateSources = {
  language: 'ru',
  candidate: `${read('profile.txt')}\n${read('owner-notes.txt')}`.split('\n').filter(Boolean),
  vacancy: [read('vac-sber.txt'), 'Екатерина', 'рекрутёр'],
};

const acceptedLetters = read('run-15-live.md')
  .split(/^## /mu)
  .slice(1)
  .map((part) => {
    const [head = '', ...rest] = part.split('\n');
    return { model: head, body: rest.join('\n').trim() };
  });

const SOURCES: LetterGateSources = {
  language: 'ru',
  candidate: [
    'Выручка выросла с 230 млн до 2 млрд рублей, рост за год 4x.',
    'CSAT с 23% до 68%. Бюджет ~$650K. Команда 250+ человек. Кампус 37,000 m².',
    'Enterprise Energy IT Services, Rosseti Tsifra. Dubai, Malaysia, Corporate University.',
    'SLA 99.5–100%. Опыт более 15 лет. Работа в 2016. Доля упала на -77%.',
  ],
  vacancy: ['Head of AI Engineering', 'Сбер', 'Екатерина', 'Python, Kubernetes', 'Ада Кондэ'],
};

const rules = (body: string, sources = SOURCES) => reviewLetterBody(`${body}\n\nРезюме приложено.`, sources).map((item) => item.rule);

describe('reviewLetterBody: принятые письма проходят', () => {
  it('в прогоне три письма трёх моделей', () => {
    expect(acceptedLetters.map((letter) => letter.model)).toHaveLength(3);
  });

  it.each(acceptedLetters)('$model: без замечаний на настоящем профиле', ({ body }) => {
    expect(reviewLetterBody(body, OWNER)).toEqual([]);
  });
});

describe('reviewLetterBody: неверные цифры', () => {
  it.each([
    ['другая величина', 'Выручка выросла до 3 млрд рублей.'],
    ['другой процент', 'CSAT вырос до 86%.'],
    ['другая кратность', 'Выручка выросла в 7 раз.'],
    ['число, которого в профиле нет', 'Команда из 900 человек.'],
    ['40 млн не подтверждает процент', 'Рост на 230%.'],
    ['другая валюта', 'Бюджет 650 тыс. рублей.'],
    ['другой год', 'С 2019 года работаю с облаком.'],
    ['минус не подтверждает плюс', 'Рост 77%.'],
  ])('останавливает: %s', (_name, body) => {
    expect(rules(body)).toContain('number');
  });

  it('останавливает обратный порядок «с … до …»', () => {
    expect(rules('CSAT упал с 68% до 23%.')).toContain('number');
  });

  it.each([
    ['перевод единиц', 'Выручка 2 млрд рублей и 230 млн в начале.'],
    ['кратность словом', 'Рост выручки в 4 раза.'],
    ['тильда и K', 'Бюджет ~$650K, или 650 тыс. долларов.'],
    ['разделитель разрядов', 'Кампус 37 000 м².'],
    ['диапазон с запятой', 'SLA 99,5–100%.'],
    ['диапазон с общим знаком процента', 'CSAT с 23 до 68%.'],
    ['плюс и порядок из исходной фразы', 'Команда 250+ человек, 15 лет опыта.'],
    ['порядок чисел в одной фразе не важен', 'Вырос до 2 млрд рублей с 230 млн.'],
    ['термин с цифрой', 'Поддержка L1/L2, n8n, B2B, 1С, 5G.'],
    ['минус как снижение', 'Обращений −23%.'],
    ['стрелка', 'CSAT 23% → 68%.'],
  ])('не трогает: %s', (_name, body) => {
    expect(rules(body)).not.toContain('number');
  });

  it('числа названия вакансии — не заслуги кандидата', () => {
    const sources = { ...SOURCES, vacancy: ['Head of Level 42', 'Сбер'] };
    expect(rules('Откликаюсь на Head of Level 42.', sources)).not.toContain('number');
  });

  it('отрицание в профиле не подтверждает цифру, а «не только» не отрицание', () => {
    const sources = { ...SOURCES, candidate: ['Я не увеличил выручку на 20%.', 'Не только рост, а ещё 35% маржи.'] };
    expect(rules('Увеличил выручку на 20%.', sources)).toContain('number');
    expect(rules('Маржа 35%.', sources)).not.toContain('number');
  });

  it('отрицание гасит только своё предложение, а не всю строку «о себе»', () => {
    const about: LetterGateSources = {
      ...SOURCES,
      candidate: ['Это не просто ИТ-роль. Команда 250 человек выросла до 300.'],
    };
    expect(rules('Команда 250 человек.', about)).not.toContain('number');
  });

  it('вакансия не подтверждает цифры кандидата', () => {
    const sources = { ...SOURCES, vacancy: ['Команда 900 человек', 'Сбер'] };
    expect(rules('Руководил командой из 900 инженеров.', sources)).toContain('number');
  });
});

describe('reviewLetterBody: общий знак процента у «с … до …» в профиле (B601, 10.11)', () => {
  const profile: LetterGateSources = {
    language: 'en',
    candidate: ['Повышение уровня сервиса с 91 до 97 %.', 'Точность сборки выросла с 97,1 до 99,6 %.', 'Текучесть с 9 до 4 % в месяц.'],
    vacancy: ['Warehouse Manager'],
  };
  const numberRules = (body: string) => reviewLetterBody(body, profile).map((item) => item.rule).filter((rule) => rule === 'number');

  it.each([
    'Service level rose from 91% to 97%. My resume is attached.',
    'Picking accuracy increased from 97.1% to 99.6%. My resume is attached.',
    'Turnover fell from 9% to 4% per month. My resume is attached.',
    'Уровень сервиса вырос с 91% до 97%. Резюме приложено.',
  ])('процент у обоих чисел подтверждён: %s', (body) => {
    expect(numberRules(body)).toEqual([]);
  });

  it('другое число по-прежнему останавливается', () => {
    expect(numberRules('Service level rose from 91% to 99%. My resume is attached.')).toEqual(['number']);
  });
});

describe('reviewLetterBody: кириллица в английском письме (B601, 10.11)', () => {
  const profile: LetterGateSources = {
    language: 'en',
    candidate: ['## Главный бухгалтер | ГК Ресурс-Логистика | Москва | 2019-04 — now', '- Перевела учёт на 1С:Бухгалтерия 8.3.'],
    vacancy: ['Chief Accountant', 'Daikan Izakaya'],
  };
  const cyrillic = (body: string) => reviewLetterBody(body, profile).filter((item) => item.rule === 'cyrillic');

  it('название компании из профиля можно оставить кириллицей', () => {
    expect(cyrillic('At ГК Ресурс-Логистика I lead accounting. My resume is attached.')).toEqual([]);
  });

  it('продукт или слово кириллицей останавливает письмо', () => {
    expect(cyrillic('I moved the books to 1С:Бухгалтерия 8.3. My resume is attached.')).toHaveLength(1);
  });

  it('русское письмо не проверяется этим правилом', () => {
    expect(reviewLetterBody('Перевела учёт на 1С:Бухгалтерия 8.3. Резюме приложено.', { ...profile, language: 'ru' })
      .filter((item) => item.rule === 'cyrillic')).toEqual([]);
  });
});

describe('reviewLetterBody: чужие компании', () => {
  it.each([
    ['русское название', 'Руководил разработкой в Газпроме.'],
    ['латиницей', 'Работал в Google над поиском.'],
    ['аббревиатура известной компании', 'Работал в ВТБ над сервисами.'],
    ['первым словом латиницей', 'Google доверил мне поиск.'],
    ['имя получателя, которого нет', 'Иван, добрый день. Пишу Вам, Марина.'],
  ])('останавливает: %s', (_name, body) => {
    expect(rules(body)).toContain('name');
  });

  it.each([
    ['склонение из вакансии', 'Со структурой Сбера знаком.'],
    ['название на другом алфавите', 'В Россети Цифра, в Дубае и в Малайзии.'],
    ['перевод названия', 'В Корпоративном Университете.'],
    ['имя получателя', 'Здравствуйте, Екатерина.'],
    ['короткое имя компании в склонении', 'Откликаюсь в компании Ады Кондэ.'],
    ['вежливое Вы', 'Буду рад обсудить Ваши задачи и Вашу команду.'],
  ])('не трогает: %s', (_name, body) => {
    expect(rules(body)).not.toContain('name');
  });

  it.each([
    ['аббревиатуры направления', 'Отвечал за SLA, CSAT, FCR, P&L, RTO, SRE, ИТ и ИИ.'],
    ['смешанный регистр', 'Строю FinOps и PostgreSQL.'],
    ['термин со строчной', 'Провёл turnaround и self-service.'],
    ['термин из вакансии', 'Работаю с Python и Kubernetes.'],
    ['аббревиатура во множественном числе (10.11)', 'Ввёл сменные KPIs и SLAs.'],
  ])('термины не отклоняет: %s', (_name, body) => {
    expect(rules(body)).toEqual([]);
  });

  it('первое слово без словаря не проверить: это остаётся непроверенным', () => {
    expect(rules('Газпром доверил мне поиск.')).toEqual([]);
  });
});

describe('reviewLetterBody: письмо на другом языке', () => {
  it('английское письмо на русскую вакансию судит как английское: «Hello» не чужое имя', () => {
    const body = 'Hello,\n\nI am applying for this role.\n\nMy CV is attached.';
    expect(reviewLetterBody(body, SOURCES)).toEqual([]);
  });

  it('в русском письме первое латинское слово по-прежнему проверяется', () => {
    expect(rules('Northwind был моим клиентом.')).toContain('name');
  });
});

describe('reviewLetterBody: склейка разных цифр (профиль без уточнений)', () => {
  const growth: LetterGateSources = {
    ...SOURCES,
    candidate: [
      'Grew combined revenue 4x and improved margin.',
      'Services had combined annual revenue of about 2 billion rubles; at the start about 230 million rubles.',
    ],
  };

  it.each([
    'Перевод услуг обеспечил 4-кратный рост выручки (до примерно 2 млрд рублей).',
    'Четырёхкратный рост выручки до 2 млрд рублей.',
    'Выручка выросла в 4 раза, с 230 млн до 2 млрд рублей.',
    'Revenue grew 4x to 2 billion rubles.',
  ])('кратный рост и сумма из разных строк профиля в одной фразе: %s', (sentence) => {
    expect(rules(sentence, growth)).toContain('number');
  });

  it('те же цифры в разных фразах проходят', () => {
    expect(rules('Выручка выросла в 4 раза. Выручка направления выросла с 230 млн до 2 млрд рублей.', growth)).toEqual([]);
  });

  it('кратный рост и сумма из одной строки профиля проходят', () => {
    const together: LetterGateSources = { ...SOURCES, candidate: ['Revenue grew 4x to $50M in two years.'] };
    expect(rules('Выручка выросла в 4 раза до $50M.', together)).toEqual([]);
  });

  it('кратный рост рядом с процентом или людьми не склейка', () => {
    const near: LetterGateSources = { ...SOURCES, candidate: ['Grew revenue 4x.', 'Margin 40%, team 250.'] };
    expect(rules('Выручка выросла в 4 раза, маржа 40%, команда 250.', near)).toEqual([]);
  });

  it('кратность словом тоже склейка', () => {
    expect(rules('Выручка выросла в четыре раза, до 2 млрд рублей.', growth)).toContain('number');
  });

  it.each([
    ['Руководил командой из 12 разработчиков и бюджетом 300 млн ₽.', ['Команда 12 разработчиков.', 'Бюджет 300 млн ₽.']],
    ['Вёл 3 разных направления с бюджетом 300 млн ₽.', ['Вёл 3 разных направления.', 'Бюджет 300 млн ₽.']],
    ['Бюджет 300 млн руб. Вырастил выручку в 4 раза.', ['Бюджет 300 млн руб.', 'Вырастил выручку в 4 раза.']],
  ])('люди и соседняя фраза не кратный рост: %s', (sentence, candidate) => {
    expect(rules(sentence, { ...SOURCES, candidate })).toEqual([]);
  });
});

describe('reviewLetterBody: стиль не отклоняет', () => {
  it.each([
    ['личное действие', 'Руководил, построил, увеличил, масштабировал и вырастил команду.'],
    ['оценка опыта', 'Обширный опыт и глубокая экспертиза.'],
    ['месяц', 'С ноября работаю над агентами.'],
    ['английский глагол', 'I led and scaled the team.'],
  ])('%s', (_name, body) => {
    expect(rules(body)).toEqual([]);
  });
});

describe('reviewLetterBody: резюме приложено (решение владельца)', () => {
  const english = { ...SOURCES, language: 'en' as const };

  it.each([['Буду рад обсудить.', SOURCES], ['Happy to discuss.', english]] as const)('письмо без упоминания резюме: %s', (body, sources) => {
    expect(reviewLetterBody(body, sources).map((item) => item.rule)).toEqual(['resume']);
  });

  it.each([['Резюме приложено.', SOURCES], ['Резюме прилагаю.', SOURCES], ['My resume is attached.', english], ['CV attached.', english]] as const)('%s', (body, sources) => {
    expect(reviewLetterBody(body, sources)).toEqual([]);
  });
});

describe('reviewLetterBody: опыта нет, резюме не приложится (B601, 08.11)', () => {
  const noResume = { ...SOURCES, resumeAttached: false };
  const english = { ...noResume, language: 'en' as const };

  it.each([['Буду рад обсудить.', noResume], ['Happy to discuss.', english]] as const)('письмо без упоминания резюме принимается: %s', (body, sources) => {
    expect(reviewLetterBody(body, sources)).toEqual([]);
  });

  it.each([['Буду рад обсудить. Резюме приложено.', noResume], ['Happy to discuss. My resume is attached.', english], ['CV attached.', english]] as const)('обещание приложить резюме отклоняется: %s', (body, sources) => {
    expect(reviewLetterBody(body, sources).map((item) => item.rule)).toEqual(['resume']);
  });
});

describe('reviewLetterBody: отчёт о нарушении', () => {
  it('называет предложение и правило один раз', () => {
    const violations = reviewLetterBody('Команда из 900 человек. Резюме приложено.', SOURCES);
    expect(violations).toEqual([{ rule: 'number', sentence: 'Команда из 900 человек.' }]);
  });
});
