import { describe, expect, it } from 'vitest';
import type { TodayQueueItem } from '../../today/todayApi';
import { queueMobileSubtitle } from '../../today/todayFormat';
import {
  applicationsSummary,
  leadText,
  moduleLayout,
  moreTitle,
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
  it('B717: одобренное письмо зовёт отправить отклик, а не одобрить ещё раз', () => {
    const action = queueAction(
      item({
        material: 'cover_letter',
        applicationId: 'a1',
        eyebrow: 'Письмо одобрено, ничего не отправлено',
      }),
    );
    expect(action).toMatchObject({
      title: 'Отправить отклик в «Гринкод»',
      sub: 'Письмо одобрено, ничего не отправлено',
      label: 'Отправить',
      shortLabel: 'Отправить',
      icon: 'send',
      path: '/app/responses/a1/letter',
    });
    // B801 (s05b): письмо на проверку.
    expect(
      queueAction(
        item({
          material: 'letter_draft',
          applicationId: 'a1',
          title: 'CTO',
          company: 'Гринкод',
          eyebrow: 'черновик',
        }),
      ),
    ).toMatchObject({
      title: 'CTO',
      sub: 'Гринкод · черновик',
      label: 'Проверить письмо',
      shortLabel: 'Проверить',
      path: '/app/responses/a1/letter',
    });
    expect(queueAction(item({ material: 'cover_letter', applicationId: 'a1' })).sub).toBe(
      'Письмо одобрено',
    );
    expect(queueMobileSubtitle(item({ material: 'cover_letter' }), false)).toBe(
      'Письмо одобрено, ждёт отправки',
    );
    expect(queueAction(item({ material: 'cover_letter', company: null })).title).toBe(
      'Отправить отклик',
    );
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
    const post = item({
      kind: 'linkedin_post',
      title: 'о найме',
      company: 'LinkedIn',
      eyebrow: 'сам не опубликуется',
    });
    expect(queueAction(post).sub).toBe('LinkedIn · черновик готов');
    expect(queueAction(item({ kind: 'linkedin_post', title: 'о найме' }))).toMatchObject({
      label: 'Открыть пост',
      path: '/app/profile/linkedin/posts',
    });
  });

  it('пост открывает свой черновик (B645 s03)', () => {
    const post = item({ kind: 'linkedin_post', title: 'о найме', draftId: 'd 2' });
    expect(queueAction(post).path).toBe('/app/profile/linkedin/posts?post=d%202');
  });

  it('«Ещё N дел» со склонением (B645 s03)', () => {
    expect(moreTitle(1)).toBe('Ещё 1 дело');
    expect(moreTitle(3)).toBe('Ещё 3 дела');
    expect(moreTitle(5)).toBe('Ещё 5 дел');
    expect(moreTitle(21)).toBe('Ещё 21 дело');
  });

  it('подробность лида — вакансия, место и деньги (B645 s03, как lead-text макета)', () => {
    expect(
      leadText(
        item({
          kind: 'follow_up',
          title: 'Руководитель платформы',
          location: 'Москва',
          salary: { from: 400000, currency: 'RUB' },
        }),
      ),
    ).toMatch(/^Руководитель платформы · Москва · .+/u);
    expect(leadText(item({ kind: 'interview', title: 'CTO' }))).toBe('CTO');
    expect(leadText(item({ kind: 'linkedin_post', title: 'о найме' }))).toBeNull();
    expect(leadText(item({ kind: 'new_vacancy', title: 'CTO', location: 'Казань' }))).toBe(
      'Казань',
    );
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
