import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkLinkedinRewrite,
  clearLinkedinRewriteCache,
  linkedinRewriteRequest,
  rewrittenSuggestions,
  type LinkedinRewriteRequest,
  type LinkedinRewriter,
} from './linkedinRewrite';
import { buildSectionSuggestions } from './sectionSuggestions';

const mem = (id: string, statement: string, domain = 'outcome') => ({ id, statement, status: 'confirmed', domain, sensitive: false });
const MEMORY = [
  mem('d1', 'Led a payments platform team of 9 engineers, hired 6 of them'),
  mem('b1', 'Cut the release cycle from 2 weeks to 3 days'),
  mem('d2', 'Built the backend of a payment gateway for online shops'),
  mem('p1', 'Proposed idea', 'outcome'),
];
const DRAFT = {
  targetRole: 'Engineering Manager',
  skills: [],
  experience: [
    { id: 'e1', title: 'Head of Development', employer: 'Fintech Lab', startDate: '2021', current: true, descriptionMemoryId: 'd1', bulletMemoryIds: ['b1'] },
    { id: 'e2', title: 'Backend Lead', employer: 'Sfera', startDate: '2017', endDate: '2021', current: false, descriptionMemoryId: 'd2', bulletMemoryIds: [] },
  ],
} as never;
const INPUT = { memory: MEMORY.slice(0, 3), draft: DRAFT };

const GOOD = {
  about: {
    text: 'I build engineering teams that ship payments software fast. At Fintech Lab I grew a team of 9 and moved releases from every 2 weeks to every 3 days.',
    factIds: ['d1', 'b1'],
  },
  places: [
    { id: 'e1', text: 'Runs a team of 9 engineers on the payments platform, 6 of them hired personally. Releases now go out every 3 days instead of every 2 weeks.', factIds: ['d1', 'b1'] },
    { id: 'e2', text: 'Owned the backend of a payment gateway serving online shops.', factIds: ['d2'] },
  ],
};

afterEach(() => clearLinkedinRewriteCache());

describe('B645: запрос переписывания профиля LinkedIn', () => {
  it('берёт подтверждённые факты «О себе» и места с фактами, язык — по фактам', () => {
    const request = linkedinRewriteRequest(INPUT, undefined);
    expect(request?.language).toBe('en');
    expect(request?.aboutFacts.map((fact) => fact.id)).toEqual(['d1', 'b1', 'd2']);
    expect(request?.places.map((place) => [place.id, place.employer, place.facts.map((f) => f.id)])).toEqual([
      ['e1', 'Fintech Lab', ['d1', 'b1']],
      ['e2', 'Sfera', ['d2']],
    ]);
  });

  it('язык вставленного «О себе» важнее языка фактов', () => {
    expect(linkedinRewriteRequest(INPUT, 'Руковожу группой разработки платёжной платформы')?.language).toBe('ru');
  });

  it('предложенные и чувствительные факты модели не уходят', () => {
    const memory = [...INPUT.memory, { ...mem('x1', 'Earned 5 million'), status: 'proposed' }, { ...mem('x2', 'Health issue'), sensitive: true }];
    const request = linkedinRewriteRequest({ memory, draft: DRAFT }, undefined);
    expect(JSON.stringify(request)).not.toMatch(/5 million|Health/u);
  });

  it('без фактов запроса нет', () => {
    expect(linkedinRewriteRequest({ memory: [], draft: DRAFT }, undefined)).toBeNull();
  });
});

describe('B645: проверка ответа модели', () => {
  const request = linkedinRewriteRequest(INPUT, undefined) as LinkedinRewriteRequest;

  it('хороший ответ проходит целиком', () => {
    const checked = checkLinkedinRewrite(request, GOOD);
    expect(checked.about?.text).toBe(GOOD.about.text);
    expect([...checked.places.keys()]).toEqual(['e1', 'e2']);
  });

  it('копия исходного факта не принимается — нужен пересказ', () => {
    const copy = { ...GOOD, places: [{ id: 'e2', text: 'Built the backend of a payment gateway for online shops.', factIds: ['d2'] }] };
    expect(checkLinkedinRewrite(request, copy).places.has('e2')).toBe(false);
  });

  it('число не из процитированных фактов, чужой факт и «я» в месте работы отбрасываются', () => {
    const bad = {
      about: { text: 'I grew a team of 40 engineers and shipped payments software every week for years.', factIds: ['d1'] },
      places: [
        { id: 'e1', text: 'I run the payments platform team and ship releases often.', factIds: ['d1'] },
        { id: 'e2', text: 'Owned the backend of a payment gateway serving online shops.', factIds: ['b1'] },
        { id: 'zz', text: 'Owned the backend of a payment gateway serving online shops.', factIds: ['d2'] },
      ],
    };
    const checked = checkLinkedinRewrite(request, bad);
    expect(checked.about).toBeNull();
    expect(checked.places.size).toBe(0);
  });

  it('B692: ссылка, почта и markdown-ссылка в тексте модели не принимаются', () => {
    const texts = [
      'Owned the backend of a payment gateway, see https://evil.example for details.',
      'Owned the backend of a payment gateway; write to hire@evil.example any time.',
      'Owned the backend of a [payment gateway](evil.example) serving online shops.',
    ];
    for (const text of texts) {
      const answer = { about: null, places: [{ id: 'e2', text, factIds: ['d2'] }] };
      expect(checkLinkedinRewrite(request, answer).places.size).toBe(0);
    }
  });

  it('больше трёх фраз у места и язык не тот — не принимается', () => {
    const long = { about: null, places: [{ id: 'e2', text: 'Owned it. Built it. Ran it. Grew it for online shops.', factIds: ['d2'] }] };
    expect(checkLinkedinRewrite(request, long).places.size).toBe(0);
    const ru = { about: null, places: [{ id: 'e2', text: 'Вёл бэкенд платёжного шлюза для интернет-магазинов.', factIds: ['d2'] }] };
    expect(checkLinkedinRewrite(request, ru).places.size).toBe(0);
  });
});

describe('B692: «О себе» опирается на факты всего профиля (прод 22.11: about.offer = null при 6 из 6 местах)', () => {
  // Результат места (домен не из «О себе») — главный довод для «О себе»: «чем это подтверждено».
  const memory = [...MEMORY.slice(0, 3), mem('x1', 'Scaled the company from a 73K seed to a 100M exit', 'achievement')];
  const draft = {
    ...(DRAFT as unknown as Record<string, unknown>),
    experience: [{ id: 'e1', title: 'Co-Founder', employer: 'Fishance', startDate: '2015', current: false, endDate: '2019', descriptionMemoryId: 'x1', bulletMemoryIds: [] }],
  } as never;
  const request = linkedinRewriteRequest({ memory, draft }, undefined) as LinkedinRewriteRequest;

  it('«О себе» со ссылкой на факт места принимается, числа сверяются с ним', () => {
    expect(request.aboutFacts.map((fact) => fact.id)).not.toContain('x1');
    const output = {
      about: { text: 'I lead technology teams and took a company from a 73K seed to a 100M exit as co-founder.', factIds: ['d1', 'x1'] },
      places: [],
    };
    expect(checkLinkedinRewrite(request, output).about?.facts.map((fact) => fact.id)).toEqual(['d1', 'x1']);
  });

  it('id не из запроса и число не из фактов по-прежнему отбрасывают «О себе»; причина сообщается без текста', () => {
    const reasons: string[] = [];
    const onReject = (section: string, reason: string) => reasons.push(`${section}:${reason}`);
    const unknown = { about: { text: 'I lead technology teams that ship products.', factIds: ['d1', 'zz'] }, places: [] };
    expect(checkLinkedinRewrite(request, unknown, onReject).about).toBeNull();
    const number = { about: { text: 'I lead technology teams and grew revenue 7 times.', factIds: ['d1'] }, places: [] };
    expect(checkLinkedinRewrite(request, number, onReject).about).toBeNull();
    const empty = { about: { text: '', factIds: [] }, places: [] };
    expect(checkLinkedinRewrite(request, empty, onReject).about).toBeNull();
    expect(reasons).toEqual(['about:unknown_fact', 'about:ungrounded_number', 'about:empty']);
  });
});

describe('B645: предложения после переписывания', () => {
  const base = buildSectionSuggestions(INPUT);

  it('«О себе» и «Опыт» — тексты модели; заголовок и навыки не меняются', async () => {
    const rewriter: LinkedinRewriter = { linkedinProfile: vi.fn(async () => GOOD) };
    const result = await rewrittenSuggestions(base, INPUT, undefined, rewriter, 1000);
    expect(result.about?.text).toBe(GOOD.about.text);
    expect(result.about?.facts.map((fact) => fact.id)).toEqual(['d1', 'b1']);
    expect(result.experience?.items?.map((item) => [item.label, item.text])).toEqual([
      ['Fintech Lab · Head of Development', GOOD.places[0]!.text],
      ['Sfera · Backend Lead', GOOD.places[1]!.text],
    ]);
    expect(result.headline).toEqual(base.headline);
  });

  it('без модели или с пустым ответом исходные факты не показываются как предложение', async () => {
    expect((await rewrittenSuggestions(base, INPUT, undefined, undefined, 1000)).about).toBeNull();
    const empty: LinkedinRewriter = { linkedinProfile: vi.fn(async () => null) };
    const result = await rewrittenSuggestions(base, INPUT, undefined, empty, 1000);
    expect(result.about).toBeNull();
    expect(result.experience).toBeNull();
  });

  it('B692: сбой модели помнится минуту — повторные открытия её не вызывают, потом попытка снова', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-20T08:00:00Z'));
      const failing: LinkedinRewriter = { linkedinProfile: vi.fn(async () => null) };
      await rewrittenSuggestions(base, INPUT, undefined, failing, 1000);
      await rewrittenSuggestions(base, INPUT, undefined, failing, 1000);
      expect(failing.linkedinProfile).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date('2026-11-20T08:01:01Z'));
      await rewrittenSuggestions(base, INPUT, undefined, failing, 1000);
      expect(failing.linkedinProfile).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ответ не успел за отведённое время — без предложения, следующий запрос берёт готовый ответ из кэша', async () => {
    let finish: (value: typeof GOOD) => void = () => undefined;
    const rewriter: LinkedinRewriter = { linkedinProfile: vi.fn(() => new Promise<typeof GOOD>((resolve) => { finish = resolve; })) };
    expect((await rewrittenSuggestions(base, INPUT, undefined, rewriter, 10)).experience).toBeNull();
    finish(GOOD);
    await Promise.resolve();
    const second = await rewrittenSuggestions(base, INPUT, undefined, rewriter, 10);
    expect(second.experience?.items).toHaveLength(2);
    expect(rewriter.linkedinProfile).toHaveBeenCalledTimes(1);
  });
});
