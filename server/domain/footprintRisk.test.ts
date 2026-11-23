import { describe, expect, it } from 'vitest';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
} from '../../shared/candidateFootprint';
import type { ConsistencyDiscrepancy } from '../../shared/candidateReputation';
import { FOOTPRINT_RISK_CATEGORIES } from '../../shared/footprintRisk';
import { buildFootprintRiskSummary } from './footprintRisk';

let counter = 0;
function finding(overrides: Partial<CandidateFootprintFinding>): CandidateFootprintFinding {
  counter += 1;
  return {
    id: `f${counter}`,
    adapter: 'sherlock',
    kind: 'profile',
    url: `https://site.test/u/${counter}`,
    title: `Профиль ${counter}`,
    detail: 'Открытый профиль',
    match: 'likely_self',
    observedAt: '2026-11-11T09:00:00.000Z',
    receipt: { method: 'sherlock', source: 'maigret', query: 'msokolova' },
    sources: ['sherlock', 'maigret'],
    receipts: [{ method: 'sherlock', source: 'maigret', query: 'msokolova' }],
    automatedMatch: 'likely_self',
    review: 'confirmed_self',
    ...overrides,
  };
}

function audit(
  findings: CandidateFootprintFinding[],
  state: CandidateFootprintAudit['state'] = 'completed',
): CandidateFootprintAudit {
  return {
    id: 'a1',
    candidateId: 'alice',
    state,
    selectedQueryIds: [],
    adapterStatuses: [],
    findings,
    ownershipConfirmedAt: '2026-11-10T09:00:00.000Z',
    startedAt: '2026-11-11T08:00:00.000Z',
    completedAt: state === 'completed' ? '2026-11-11T09:30:00.000Z' : undefined,
  };
}

const mismatch: ConsistencyDiscrepancy = {
  id: 'd1',
  field: 'Должность',
  candidateValue: 'Руководитель группы разработки',
  externalValue: 'тимлид',
  externalSource: 'https://conf.site.test/speakers/sokolova',
  severity: 'warning',
  suggestion: 'Попросите организаторов исправить должность.',
};

describe('buildFootprintRiskSummary', () => {
  it('пока проверки не было — состояние «не проверяли», заголовка нет, категорий пять', () => {
    const summary = buildFootprintRiskSummary(null, []);
    expect(summary).toMatchObject({
      state: 'not_checked',
      headline: null,
      total: 0,
      toRemove: 0,
      items: [],
    });
    expect(summary.categories.map((category) => category.id)).toEqual([
      ...FOOTPRINT_RISK_CATEGORIES,
    ]);
    expect(
      summary.categories.every((category) => category.count === 0 && category.level === null),
    ).toBe(true);
  });

  it('проверка идёт или сорвалась — так и говорит', () => {
    expect(buildFootprintRiskSummary(audit([], 'pending'), []).state).toBe('checking');
    expect(buildFootprintRiskSummary(audit([], 'failed'), []).state).toBe('failed');
  });

  it('находок нет — честное «Ничего рискового»', () => {
    const summary = buildFootprintRiskSummary(audit([]), []);
    expect(summary).toMatchObject({
      state: 'ready',
      headline: 'Ничего рискового',
      total: 0,
      toRemove: 0,
    });
    expect(summary.checkedAt).toBe('2026-11-11T09:30:00.000Z');
  });

  it('есть только полезные находки — рискового нет, убирать нечего', () => {
    const summary = buildFootprintRiskSummary(
      audit([finding({}), finding({ kind: 'mention' })]),
      [],
    );
    expect(summary.headline).toBe('2 находки, ничего рискового');
    expect(summary.toRemove).toBe(0);
    expect(
      summary.items.every((item) => item.category === 'useful_evidence' && item.level === 'useful'),
    ).toBe(true);
  });

  it('каждая находка получает одну из пяти категорий, уровень и действие', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({
          id: 'leak',
          kind: 'breach',
          url: null,
          title: 'Почта в утечке сервиса доставки',
        }),
        finding({ id: 'key', kind: 'secret', title: 'Открытый ключ в репозитории' }),
        finding({ id: 'meta', kind: 'metadata', title: 'Метаданные документа: автор' }),
        finding({ id: 'old', kind: 'profile', staleAccount: true, title: 'Мой Круг' }),
        finding({ id: 'arch', kind: 'archive', title: 'Старая версия страницы' }),
        finding({ id: 'gh', kind: 'profile', title: 'GitHub' }),
        finding({
          id: 'who',
          kind: 'mention',
          review: 'unreviewed',
          automatedMatch: 'unknown',
          match: 'unknown',
          title: 'Упоминание',
        }),
        finding({ id: 'odd', kind: 'something_new', title: 'Неизвестный вид' }),
      ]),
      [mismatch],
    );
    const byId = Object.fromEntries(summary.items.map((item) => [item.id, item]));
    expect([byId.leak.category, byId.leak.level, byId.leak.action]).toEqual([
      'personal_data',
      'high',
      { kind: 'close_account', label: 'Закрыть аккаунты' },
    ]);
    expect([byId.key.category, byId.key.level, byId.key.action?.kind]).toEqual([
      'needs_check',
      'important',
      'check_now',
    ]);
    expect([byId.meta.category, byId.meta.level, byId.meta.action?.kind]).toEqual([
      'personal_data',
      'low',
      'hide',
    ]);
    expect([byId.old.category, byId.old.level, byId.old.action?.kind]).toEqual([
      'stale_profile',
      'low',
      'hide',
    ]);
    expect(byId.arch.category).toBe('stale_profile');
    expect([byId.gh.category, byId.gh.level, byId.gh.action]).toEqual([
      'useful_evidence',
      'useful',
      // B382: профиль площадки в профиль не переносится — только «Это не моё».
      { kind: 'not_mine', label: 'Это не моё' },
    ]);
    expect([byId.who.category, byId.who.level]).toEqual(['needs_check', 'important']);
    expect(byId.odd.category).toBe('needs_check');
    expect([byId['mismatch:d1'].category, byId['mismatch:d1'].action]).toEqual([
      'resume_mismatch',
      { kind: 'ask_to_fix', label: 'Попросить исправить' },
    ]);
    expect(
      summary.items.every(
        (item) => FOOTPRINT_RISK_CATEGORIES.includes(item.category) && item.levelLabel,
      ),
    ).toBe(true);
  });

  it('сводка считает находки по категориям, называет где найдено и сколько стоит убрать', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({ kind: 'breach', title: 'Книжный клуб' }),
        finding({ kind: 'breach', title: 'Сервис доставки' }),
        finding({ kind: 'profile', staleAccount: true, title: 'Мой Круг' }),
        finding({ kind: 'profile', title: 'GitHub' }),
      ]),
      [mismatch],
    );
    expect(summary.headline).toBe('5 находок, 4 стоит убрать');
    const counts = Object.fromEntries(
      summary.categories.map((category) => [category.id, category.count]),
    );
    expect(counts).toEqual({
      personal_data: 2,
      needs_check: 0,
      resume_mismatch: 1,
      stale_profile: 1,
      useful_evidence: 1,
    });
    const personal = summary.categories[0];
    expect(personal).toMatchObject({
      title: 'Личные данные открыты',
      level: 'high',
      levelLabel: 'высокий риск',
      where: 'Книжный клуб · Сервис доставки',
    });
    expect(summary.categories[1]).toMatchObject({
      count: 0,
      level: null,
      levelLabel: null,
      where: '',
    });
  });

  it('порядок: рисковые, затем нейтральные, затем полезные', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({ kind: 'profile', title: 'GitHub' }),
        finding({ kind: 'archive', title: 'Архив' }),
        finding({ kind: 'secret', title: 'Ключ' }),
        finding({ kind: 'breach', title: 'Утечка' }),
      ]),
      [],
    );
    expect(summary.items.map((item) => item.level)).toEqual(['high', 'important', 'low', 'useful']);
  });

  it('«не моё» и скрытое в сводку не идут; разобранное не считается в «стоит убрать»', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({ kind: 'breach', review: 'not_self' }),
        finding({ kind: 'breach', review: 'hidden' }),
        finding({ id: 'done', kind: 'breach', checklistMark: 'password_changed' }),
        finding({ id: 'kept', kind: 'profile', staleAccount: true, checklistMark: 'account_kept' }),
        finding({ id: 'open', kind: 'archive' }),
      ]),
      [],
    );
    expect(summary.items.map((item) => item.id).sort()).toEqual(['done', 'kept', 'open']);
    expect(summary.items.find((item) => item.id === 'done')?.resolved).toBe(true);
    expect(summary.headline).toBe('3 находки, 1 стоит убрать');
  });

  it('расхождение привязано к находке с той же страницы; без такой находки — отдельная строка', () => {
    const page = finding({
      id: 'conf',
      kind: 'mention',
      url: 'https://conf.site.test/speakers/sokolova#bio',
      title: 'Сайт конференции',
    });
    const linked = buildFootprintRiskSummary(audit([page]), [mismatch]).items.find(
      (item) => item.category === 'resume_mismatch',
    );
    expect(linked).toMatchObject({
      findingId: 'conf',
      url: 'https://conf.site.test/speakers/sokolova',
      title: 'Должность: «тимлид»',
      mismatch: {
        field: 'Должность',
        profileValue: 'Руководитель группы разработки',
        foundValue: 'тимлид',
      },
      level: 'low',
    });
    const alone = buildFootprintRiskSummary(audit([]), [
      { ...mismatch, severity: 'critical', externalSource: 'Сайт конференции' },
    ]).items[0];
    expect(alone).toMatchObject({ findingId: null, url: null, level: 'high' });
  });

  it('в ответе нет названий инструментов и способа поиска', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({
          title: 'Sherlock: профиль на GitHub',
          detail: 'Найдено через Maigret и HIBP, архив Wayback, поиск Exa',
        }),
        finding({ kind: 'breach', title: 'Утечка (HIBP)' }),
      ]),
      [mismatch],
    );
    const body = JSON.stringify(summary).toLowerCase();
    for (const word of [
      'sherlock',
      'maigret',
      'hibp',
      'wayback',
      'receipt',
      'adapter',
      'msokolova',
      'sources',
    ]) {
      expect(body, word).not.toContain(word);
    }
    expect(body).not.toMatch(/\bexa\b/u);
    expect(summary.items.find((item) => item.category === 'personal_data')?.title).toBe('Утечка');
    expect(summary.items.find((item) => item.category === 'useful_evidence')?.title).toBe(
      'профиль на GitHub',
    );
  });

  it('у копии из веб-архива отдаёт адрес самой страницы', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({
          kind: 'archive',
          url: 'https://web.archive.org/web/20160101000000/https://moikrug.test/sokolova',
        }),
      ]),
      [],
    );
    expect(summary.items[0].url).toBe('https://moikrug.test/sokolova');
  });

  it('расхождение по названию площадки привязывается к находке этой площадки', () => {
    const page = finding({
      id: 'li',
      title: 'Профиль LinkedIn',
      url: 'https://linkedin.test/in/sokolova',
    });
    const item = buildFootprintRiskSummary(audit([page]), [
      { ...mismatch, externalSource: 'LinkedIn' },
    ]).items.find((entry) => entry.category === 'resume_mismatch');
    expect(item).toMatchObject({ findingId: 'li', url: 'https://linkedin.test/in/sokolova' });
  });

  it('оборванную проверку не показывает идущей', () => {
    expect(buildFootprintRiskSummary(audit([], 'pending'), [], { checkRunning: false }).state).toBe(
      'failed',
    );
    expect(buildFootprintRiskSummary(audit([], 'pending'), [], { checkRunning: true }).state).toBe(
      'checking',
    );
  });

  it('путь удаления: запрос и итог проверки идут в находку; «удалено» снимает её из «стоит убрать» (B382)', () => {
    const sent = finding({
      id: 'sent',
      kind: 'breach',
      removal: { requestedAt: '2026-11-11T10:00:00.000Z' },
    });
    const gone = finding({
      id: 'gone',
      kind: 'breach',
      removal: {
        requestedAt: '2026-11-11T10:00:00.000Z',
        checkedAt: '2026-11-12T10:00:00.000Z',
        result: 'removed',
      },
    });
    const summary = buildFootprintRiskSummary(audit([sent, gone]), []);
    const byId = new Map(summary.items.map((item) => [item.id, item]));
    expect(byId.get('sent')).toMatchObject({
      resolved: false,
      removal: { requestedAt: '2026-11-11T10:00:00.000Z' },
    });
    expect(byId.get('gone')).toMatchObject({ resolved: true, removal: { result: 'removed' } });
    expect(summary.toRemove).toBe(1);
  });

  it('ссылку отдаёт только http(s)', () => {
    const summary = buildFootprintRiskSummary(audit([finding({ url: 'javascript:alert(1)' })]), []);
    expect(summary.items[0].url).toBeNull();
  });

  it('B645 p02: одна страница — одна находка; счёт после склейки', () => {
    const detail = 'Открытая страница найдена по нику; владение нужно подтвердить.';
    const summary = buildFootprintRiskSummary(
      audit([
        finding({ title: 'Duolingo', url: 'https://www.duolingo.com/profile/adenisov', detail }),
        finding({ title: 'Duolingo', url: 'https://duolingo.com/profile/adenisov/', detail }),
        finding({ title: 'Duolingo', url: 'https://duolingo.com/profile/a.denisov', detail }),
      ]),
      [],
    );
    expect(summary.total).toBe(2);
    expect(summary.items.map((item) => item.detail)).toEqual([
      'duolingo.com/profile/adenisov · Открытая страница найдена по нику.',
      'duolingo.com/profile/a.denisov · Открытая страница найдена по нику.',
    ]);
  });

  it('B645 p02: из двух копий остаётся разобранная', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({ title: 'Topcoder', url: 'https://topcoder.com/members/ad' }),
        finding({
          title: 'Topcoder',
          url: 'https://topcoder.com/members/ad',
          checklistMark: 'account_kept',
        }),
      ]),
      [],
    );
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0].resolved).toBe(true);
  });

  it('B668: находка о самой странице важнее её копии в архиве', () => {
    const archived = (stamp: string) =>
      finding({
        adapter: 'wayback',
        title: 'Архивная копия',
        url: `https://web.archive.org/web/${stamp}/https://www.youtube.com/@Google`,
      });
    const summary = buildFootprintRiskSummary(
      audit([
        archived('20240101000000'),
        archived('20250101000000'),
        finding({
          adapter: 'youtube',
          title: 'Канал YouTube @Google',
          url: 'https://www.youtube.com/@Google',
          detail: 'Канал по вашей ссылке существует',
        }),
      ]),
      [],
    );
    expect(summary.items.map((item) => item.title)).toEqual(['Канал YouTube @Google']);
  });

  it('B668: разобранная архивная копия остаётся важнее неразобранной страницы', () => {
    const summary = buildFootprintRiskSummary(
      audit([
        finding({
          adapter: 'wayback',
          url: 'https://web.archive.org/web/2024/https://site.test/page',
          checklistMark: 'account_kept',
        }),
        finding({ url: 'https://site.test/page' }),
      ]),
      [],
    );
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0].resolved).toBe(true);
  });

  it('B645 p02: адрес уже в описании — второй раз не пишем', () => {
    const summary = buildFootprintRiskSummary(
      audit([finding({ url: 'https://site.test/u/x', detail: 'Страница site.test/u/x открыта' })]),
      [],
    );
    expect(summary.items[0].detail).toBe('Страница site.test/u/x открыта');
  });

  describe('B727: страница по нику без подтверждения — «Нужно проверить сейчас»', () => {
    const nick = (overrides: Partial<CandidateFootprintFinding> = {}) =>
      finding({
        title: 'Duolingo',
        url: 'https://www.duolingo.com/profile/alexey_denisov',
        detail: 'Открытая страница найдена по нику; владение нужно подтвердить.',
        review: 'unreviewed',
        ...overrides,
      });

    it('важно, «Проверить» открывает страницу, полезные её не считают', () => {
      const summary = buildFootprintRiskSummary(audit([nick(), finding({ title: 'GitHub' })]), []);
      const item = summary.items.find((entry) => entry.title === 'Duolingo');
      expect(item).toMatchObject({
        category: 'needs_check',
        level: 'important',
        action: { kind: 'confirm_owner', label: 'Проверить' },
        url: 'https://www.duolingo.com/profile/alexey_denisov',
      });
      expect(summary.categories.find((entry) => entry.id === 'useful_evidence')?.count).toBe(1);
      expect(summary.categories.find((entry) => entry.id === 'needs_check')?.count).toBe(1);
    });

    it('строка без «владение нужно подтвердить» — действие уже в кнопке', () => {
      const [item] = buildFootprintRiskSummary(audit([nick()]), []).items;
      expect(item!.detail).toBe('duolingo.com/profile/alexey_denisov · Открытая страница найдена по нику.');
    });

    it('подтверждённая или добавленная в профиль — остаётся полезной', () => {
      const summary = buildFootprintRiskSummary(
        audit([
          nick({ review: 'confirmed_self' }),
          nick({ url: 'https://profiles.topcoder.com/alexey_denisov', checklistMark: 'added_to_profile' }),
        ]),
        [],
      );
      expect(summary.items.map((entry) => entry.category)).toEqual(['useful_evidence', 'useful_evidence']);
    });

    it('«стоит убрать» не считает страницы, владелец которых не подтверждён (B645 p02)', () => {
      const pages = Array.from({ length: 7 }, (_, index) =>
        nick({ url: `https://site${index}.test/alexey_denisov` }),
      );
      expect(buildFootprintRiskSummary(audit(pages), []).headline).toBe('7 находок');
      const mixed = buildFootprintRiskSummary(
        audit([...pages.slice(0, 2), finding({ title: 'Телефон', category: 'personal_data' } as never)]),
        [],
      );
      expect(mixed.toRemove).toBe(mixed.items.filter((item) => item.action?.kind !== 'confirm_owner' && item.level !== 'useful').length);
    });

    it('«стоит убрать» не считает и непроверенные страницы с «Проверить» (B645 p02)', () => {
      const pages = Array.from({ length: 6 }, (_, index) =>
        nick({ url: `https://site${index}.test/alexey_denisov` }),
      );
      const unsure = finding({ kind: 'mention', review: 'unreviewed', automatedMatch: 'unknown' } as never);
      const summary = buildFootprintRiskSummary(audit([...pages, unsure]), []);
      expect(summary.items.map((item) => item.action?.kind)).toContain('check_now');
      expect(summary.toRemove).toBe(0);
      expect(summary.headline).toBe('7 находок');
    });

    it('«Это не моё» — находка уходит из сводки', () => {
      const summary = buildFootprintRiskSummary(audit([nick({ review: 'not_self' })]), []);
      expect(summary.items).toEqual([]);
    });
  });
});


describe('B645 f03b: строка «Риск» — уровень и почему', () => {
  const reasonOf = (overrides: Partial<CandidateFootprintFinding>): string | undefined =>
    buildFootprintRiskSummary(audit([finding(overrides)]), []).items[0]?.levelReason;

  it('у каждой находки есть причина уровня по её виду', () => {
    expect(reasonOf({ kind: 'breach', adapter: 'hibp' })).toBe('старые аккаунты на эту почту ещё открыты');
    expect(reasonOf({ review: 'unreviewed', automatedMatch: 'unknown' })).toBe(
      'страницу находят по нику, чья она — неизвестно',
    );
    expect(reasonOf({ kind: 'mention', adapter: 'exa', review: 'unreviewed', automatedMatch: 'unknown' })).toBe(
      'совпадение по имени не подтверждено',
    );
    expect(reasonOf({ kind: 'profile', review: 'confirmed_self' })).toBe('подтверждает ваш опыт');
    expect(reasonOf({ kind: 'archive', adapter: 'wayback' })).toBe('старая копия страницы ещё открыта');
    const all = ['breach', 'metadata', 'secret', 'archive', 'profile', 'mention'].map((kind) =>
      reasonOf({ kind: kind as CandidateFootprintFinding['kind'], staleAccount: kind === 'profile' }),
    );
    // Кандидату не называем инструменты и не пугаем словами «утечка», «пароль» (B667).
    expect(all.join(' · ')).not.toMatch(/sherlock|maigret|hibp|wayback|exa\b|утечк|парол/iu);
  });
});
