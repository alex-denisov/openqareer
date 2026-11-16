import { describe, expect, it } from 'vitest';
import type { TodayQueueItem } from '../../today/todayApi';
import {
  applicationsSummary,
  funnelLine,
  moduleLayout,
  queueAction,
  skillFit,
  vacancyRow,
} from './todayModel';

function item(overrides: Partial<TodayQueueItem>): TodayQueueItem {
  return {
    kind: 'candidate_turn',
    title: 'Head of Engineering',
    company: 'Гринкод',
    eyebrow: null,
    dueAt: null,
    fit: null,
    ...overrides,
  };
}

describe('b640 today: действие строки очереди', () => {
  it('письмо на одобрение ведёт к письму отклика', () => {
    const action = queueAction(
      item({ material: 'cover_letter', applicationId: 'a1', eyebrow: 'черновик' }),
    );
    expect(action).toMatchObject({
      title: 'Одобрить письмо в «Гринкод»',
      sub: 'черновик',
      label: 'Проверить письмо',
      shortLabel: 'Проверить',
      icon: 'file',
      path: '/app/responses/a1/letter',
    });
  });

  it('интервью ведёт к подготовке; без отклика — к ближайшему интервью', () => {
    expect(queueAction(item({ kind: 'interview', applicationId: 'a2' }))).toMatchObject({
      label: 'Подготовиться',
      path: '/app/responses/a2/interview',
    });
    expect(queueAction(item({ kind: 'interview' })).path).toBe('/app/responses/next/interview');
  });

  it('напоминание и ход кандидата открывают отклик, без отклика — список', () => {
    expect(queueAction(item({ kind: 'follow_up', applicationId: 'a3' }))).toMatchObject({
      label: 'Открыть отклик',
      path: '/app/responses/a3',
    });
    expect(queueAction(item({ kind: 'candidate_turn' })).path).toBe('/app/responses');
  });

  it('вакансия открывает карточку, пост — посты LinkedIn', () => {
    expect(queueAction(item({ kind: 'new_vacancy', clusterId: 'c 1' }))).toMatchObject({
      label: 'Открыть вакансию',
      path: '/app/vacancies/c%201',
    });
    expect(queueAction(item({ kind: 'shortlist' })).path).toBe('/app/vacancies');
    expect(queueAction(item({ kind: 'linkedin_post', title: 'о найме' }))).toMatchObject({
      label: 'Открыть пост',
      path: '/app/profile/linkedin/posts',
    });
  });
});

describe('b640 today: строка статуса', () => {
  it('собирает путь откликов из воронки', () => {
    expect(funnelLine({ favorites: 4, applied: 13, responses: 2, interviews: 1, offers: 1 })).toBe(
      '13 откликов → 1 интервью → 1 оффер',
    );
    expect(funnelLine({ favorites: 0, applied: 1, responses: 0, interviews: 0, offers: 0 })).toBe(
      '1 отклик → 0 интервью → 0 офферов',
    );
  });

  it('без числа откликов строки нет', () => {
    expect(funnelLine(undefined)).toBeNull();
    expect(funnelLine({ favorites: 1, responses: 0, offers: 0 })).toBeNull();
    expect(funnelLine({ favorites: 1, applied: 0, responses: 0, offers: 0 })).toBeNull();
  });
});

describe('b640 today: требования новой профессии', () => {
  const demand = {
    roleTitle: 'Продакт-менеджер',
    sampleSize: 118,
    observedAt: '2026-11-10T09:00:00.000Z',
    skills: [
      { name: 'Планирование релизов', vacancies: 40, inProfile: true },
      { name: 'A/B-тесты', vacancies: 31, inProfile: false },
      { name: 'Метрики качества', vacancies: 22, inProfile: true },
    ],
  };

  it('делит требования на «Есть» и «Не хватает» и считает заголовок', () => {
    expect(skillFit(demand)).toEqual({
      title: '2 из 3 частых требований у вас уже есть',
      role: 'Продакт-менеджер',
      have: ['Планирование релизов', 'Метрики качества'],
      lack: ['A/B-тесты'],
      source: 'Частые требования — из 118 вакансий по роли «Продакт-менеджер», на 10.11.',
    });
  });

  it('без требований модуля нет', () => {
    expect(skillFit({ ...demand, skills: [] })).toBeNull();
    expect(skillFit(undefined)).toBeNull();
  });
});

describe('b640 today: отклики и вакансии', () => {
  it('сводка откликов называет число и ближайшее интервью', () => {
    expect(
      applicationsSummary(
        { favorites: 0, applied: 7, responses: 0, offers: 0 },
        {
          company: 'Арка Холдинг',
          title: 'Руководитель платформы',
          round: 1,
          at: '2026-11-12T12:00:00.000Z',
        },
        'Europe/Moscow',
      ),
    ).toEqual({
      title: 'Ваши отклики: 7',
      text: 'Ближайшее: Арка Холдинг, интервью 12 ноября, 15:00.',
    });
  });

  it('без откликов сводки нет, без интервью нет второй строки', () => {
    expect(applicationsSummary(undefined, null, 'UTC')).toBeNull();
    expect(
      applicationsSummary({ favorites: 0, applied: 2, responses: 0, offers: 0 }, null, 'UTC'),
    ).toEqual({
      title: 'Ваши отклики: 2',
      text: null,
    });
  });

  it('строка вакансии: компания и место, вилка, совпадение', () => {
    const row = vacancyRow({
      cluster: {
        id: 'v1',
        canonicalTitle: 'Руководитель разработки',
        canonicalCompany: 'Ладога Банк',
        canonicalLocation: 'Москва, гибрид',
        salary: { from: 480000, to: 580000, currency: 'RUB' },
      },
      explanation: { fitView: { result: { coveragePercent: 86 } } },
    } as never);
    expect(row).toEqual({
      id: 'v1',
      title: 'Руководитель разработки',
      sub: 'Ладога Банк · Москва, гибрид',
      salary: '480–580 тыс. ₽',
      fit: 86,
      path: '/app/vacancies/v1',
    });
  });

  it('без оценки совпадения процент не показываем', () => {
    const row = vacancyRow({
      cluster: { id: 'v2', canonicalTitle: 'CTO', canonicalCompany: 'Сфера' },
      explanation: {},
    } as never);
    expect(row).toMatchObject({ sub: 'Сфера', salary: 'не указана', fit: null });
  });
});

describe('b640 today: раскладка модулей по колонкам', () => {
  const keys = (list: readonly { key: string }[]) => list.map((entry) => entry.key);
  const modules = (...list: string[]) => list.map((key) => ({ key, title: key })) as never;

  it('«Ищу работу»: дела слева, вопрос о профиле справа', () => {
    const layout = moduleLayout(
      'job_search',
      modules('next_action', 'applications_summary', 'profile_question'),
    );
    expect(keys(layout.main)).toEqual(['next_action', 'applications_summary']);
    expect(keys(layout.side)).toEqual(['profile_question']);
  });

  it('«Меняю профессию»: отклики уходят в правую колонку, причины нет', () => {
    const layout = moduleLayout(
      'changing_profession',
      modules('profession_fit', 'profession_reason', 'profile_question', 'applications_summary'),
    );
    expect(keys(layout.main)).toEqual(['profession_fit', 'profile_question']);
    expect(keys(layout.side)).toEqual(['applications_summary']);
  });

  it('«Работаю»: остаётся только план, встреча и результат не показаны', () => {
    const layout = moduleLayout(
      'working',
      modules('onboarding_plan', 'next_meeting', 'record_result'),
    );
    expect(keys(layout.main)).toEqual(['onboarding_plan']);
    expect(layout.side).toEqual([]);
  });
});
