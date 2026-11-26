import { afterEach, describe, expect, it } from 'vitest';
import type { CoverLetterWriteInput, CoverLetterWriter } from '../providers/coverLetterWriter';
import { SqliteContactMessageRepository } from '../data/sqliteContactMessageRepository';
import { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { createB640Harness, poolItem, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/contact-messages';
const CONTACTS = '/api/v1/candidate/b640/contacts';
const OLD = '/api/v1/candidate/connection-contacts';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

interface Writer extends CoverLetterWriter {
  readonly calls: CoverLetterWriteInput[];
  body: string | undefined;
}

function stubWriter(body: string | undefined): Writer {
  const writer: Writer = {
    calls: [],
    body,
    async writeCoverLetter(input) {
      writer.calls.push(input);
      return writer.body ? { body: writer.body, stage: 'stub' } : { stage: 'stub', failure: { stage: 'stub', kind: 'timeout' } };
    },
  };
  return writer;
}

async function setup(modelBody: string | undefined = 'Анна, привет! Давно не общались. Я ищу роль директора по данным, не подскажете, кто у вас занимается наймом?') {
  const writer = stubWriter(modelBody);
  const h = await createB640Harness({
    pool: () => [poolItem({ id: 'c1', title: 'Директор по данным', company: 'Ромашка' })],
    coverLetterWriter: writer,
    engine: { getActiveCluster: () => ({ canonicalTitle: 'Директор по данным', canonicalCompany: 'Ромашка' }) },
  });
  closers.push(h.close);
  const own = h.candidateIds['flagged.test'];
  h.candidates.saveResumeDraft(own, { ...EMPTY_RESUME_DRAFT, targetRole: 'Директор по данным',
    candidate: { ...EMPTY_RESUME_DRAFT.candidate, fullName: 'Пётр Сидоров', headline: 'Руководитель аналитики' } }, []);
  const send = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, user?: HarnessUser, payload?: object) =>
    h.app.inject({
      method, url, ...(payload ? { payload } : {}),
      headers: { ...(user ? { authorization: `Bearer ${h.tokens[user]}` } : {}), origin: 'http://localhost:3000' },
    });
  const seed = (id: string, body: object, user: HarnessUser = 'flagged.test') =>
    send('PUT', `${OLD}/${id}`, user, { roleTitle: 'Рекрутер', relationship: 'Коллега', strength: 'strong', ...body });
  const draft = async (body: object = { contactId: 'anna', kind: 'known_contact' }) => {
    await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа', linkedinUrl: 'https://www.linkedin.com/in/anna-kim' });
    return send('POST', BASE, 'flagged.test', body);
  };
  return { h, send, seed, draft, writer };
}

describe('B698: без флага', () => {
  it('все маршруты отвечают 404, прежний маршрут контактов работает', async () => {
    const { send, seed } = await setup();
    for (const [method, url] of [['POST', BASE], ['GET', `${BASE}?contactId=a`], ['GET', `${BASE}/sent?vacancyId=c1`], ['PUT', `${BASE}/x`], ['POST', `${BASE}/x/approve`], ['POST', `${BASE}/x/sent`]] as const) {
      expect((await send(method, url, 'plain.test', { contactId: 'a', kind: 'known_contact', text: 'x' })).statusCode).toBe(404);
      expect((await send(method, url, undefined, {})).statusCode).toBe(404);
    }
    expect((await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа' }, 'plain.test')).statusCode).toBe(201);
    expect((await send('GET', OLD, 'plain.test')).json().data.items[0]).toMatchObject({ id: 'anna' });
  });
});

describe('B698: POST contact-messages', () => {
  it('готовит черновик знакомому: текст до 600 знаков, получатель без почты и телефона', async () => {
    const { draft, writer } = await setup();
    const res = await draft();
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data).toMatchObject({ kind: 'known_contact', recipient: { name: 'Анна Ким', linkedinUrl: 'https://www.linkedin.com/in/anna-kim' } });
    expect(data.text.length).toBeLessThanOrEqual(600);
    expect(data.text).toContain('директора по данным');
    expect(JSON.stringify(res.json())).not.toMatch(/email|phone/iu);
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]?.wish).toContain('Анна Ким');
  });

  it('при сбое модели или выдуманной цифре берёт шаблон на фактах профиля', async () => {
    const failed = await setup(undefined);
    const a = (await failed.draft()).json().data;
    expect(a.text.length).toBeGreaterThan(20);
    expect(a.text).toContain('Анна');
    const invented = await setup('Анна, привет! Я вырастил выручку на 300% и ищу работу.');
    const b = (await invented.draft()).json().data;
    expect(b.text).not.toContain('300');
  });

  it('B753: знакомому «Откликаюсь на вакансию…» не принимается — шаблон', async () => {
    const formula = await setup('Анна, добрый день! Откликаюсь на вакансию директора по данным в Альфа.');
    const text = (await formula.draft()).json().data.text as string;
    expect(text).not.toContain('Откликаюсь');
    expect(text).toContain('Анна');
  });

  it('проверяет тело: нужен ровно один получатель, вид из списка, чужой контакт — 404', async () => {
    const { send, draft, seed } = await setup();
    await draft();
    const post = (body: object) => send('POST', BASE, 'flagged.test', body);
    expect((await post({ kind: 'known_contact' })).statusCode).toBe(400);
    expect((await post({ contactId: 'anna', recruiterId: 'r', kind: 'recruiter' })).statusCode).toBe(400);
    expect((await post({ contactId: 'anna', kind: 'spam' })).statusCode).toBe(400);
    expect((await post({ contactId: 'nope', kind: 'known_contact' })).statusCode).toBe(404);
    await seed('boris', { fullName: 'Борис', companyName: 'Бета' }, 'other.test');
    expect((await post({ contactId: 'boris', kind: 'known_contact' })).statusCode).toBe(404);
  });

  it('пишет рекрутёру по вакансии', async () => {
    const { h, send, writer } = await setup();
    const repo = new SqliteRecruiterContactsRepository({ databasePath: h.databasePath });
    repo.saveContacts(h.candidateIds['flagged.test'], 'c1', [{
      id: 'rec1', vacancyId: 'c1', companyName: 'Ромашка', fullName: 'Мария Ли', roleTitle: 'Рекрутёр',
      email: 'maria@romashka.example', emailStatus: 'verified', phone: '+70000000000', telegram: null, whatsapp: null,
      linkedinUrl: 'https://www.linkedin.com/in/maria-li', githubUrl: null, twitterUrl: null,
      sourceType: 'test', confidence: 0.9, createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
    }]);
    repo.close();
    const res = await send('POST', BASE, 'flagged.test', { recruiterId: 'rec1', vacancyId: 'c1', kind: 'recruiter' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.recipient).toEqual({ name: 'Мария Ли', linkedinUrl: 'https://www.linkedin.com/in/maria-li' });
    expect(JSON.stringify(res.json())).not.toMatch(/maria@|\+7000|email|phone/iu);
    expect(writer.calls[0]?.vacancy.title).toBe('Директор по данным');
    expect((await send('POST', BASE, 'flagged.test', { recruiterId: 'rec1', kind: 'recruiter' })).statusCode).toBe(404);
  });
});

describe('B682: POST contact-messages/:id/variants', () => {
  const list = (id: string) => `/api/v1/candidate/text-variants?kind=message&subjectId=${id}`;

  it('пишет вариант с пожеланием, хранит у черновика; четвёртый — 409 без модели', async () => {
    const { draft, send, writer } = await setup();
    const id = (await draft()).json().data.id as string;
    writer.body = 'Анна, привет! Давно не общались. Расскажешь, как устроена команда данных?';
    const make = (body: object = {}) => send('POST', `${BASE}/${id}/variants`, 'flagged.test', body);
    const first = await make({ wish: { chips: ['shorter'], text: 'на «вы»' } });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ remaining: 2, variant: { position: 1, text: writer.body } });
    expect(writer.calls.at(-1)?.wish).toContain('заметно короче');
    expect(writer.calls.at(-1)?.wish).toContain('Прежний текст');
    expect((await send('GET', list(id), 'flagged.test')).json().data.variants).toHaveLength(1);
    await make();
    expect((await make()).json().data.remaining).toBe(0);
    const calls = writer.calls.length;
    const fourth = await make();
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error.code).toBe('variant_limit_reached');
    expect(writer.calls).toHaveLength(calls);
  });

  it('повторное открытие продолжает черновик: предел в три не обойти, после отправки — новый', async () => {
    const { draft, send, writer } = await setup();
    const id = (await draft()).json().data.id as string;
    writer.body = 'Анна, привет! Давно не общались. Расскажешь, как устроена команда данных?';
    const make = (messageId: string) => send('POST', `${BASE}/${messageId}/variants`, 'flagged.test', {});
    for (let step = 0; step < 3; step += 1) expect((await make(id)).statusCode).toBe(201);
    const calls = writer.calls.length;
    const again = await draft();
    expect([again.statusCode, again.json().data.id]).toEqual([200, id]);
    expect((await make(again.json().data.id)).statusCode).toBe(409);
    expect(writer.calls).toHaveLength(calls);
    expect((await send('GET', list(id), 'flagged.test')).json().data.variants).toHaveLength(3);
    const other = await draft({ contactId: 'anna', vacancyId: 'c1', kind: 'known_contact' });
    expect(other.json().data.id).not.toBe(id);
    await send('POST', `${BASE}/${id}/approve`, 'flagged.test');
    expect((await draft()).json().data.id).toBe(id);
    await send('POST', `${BASE}/${id}/approve`, 'flagged.test');
    await send('POST', `${BASE}/${id}/sent`, 'flagged.test');
    expect((await draft()).json().data.id).not.toBe(id);
  });

  it('два запроса сразу дают один черновик; сменился адрес получателя — новый черновик', async () => {
    const { seed, send } = await setup();
    await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа', linkedinUrl: 'https://www.linkedin.com/in/anna-kim' });
    const body = { contactId: 'anna', kind: 'known_contact' };
    const [a, b] = await Promise.all([0, 1].map(() => send('POST', BASE, 'flagged.test', body)));
    expect(a!.json().data.id).toBe(b!.json().data.id);
    await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа', linkedinUrl: 'https://www.linkedin.com/in/anna-new' });
    const moved = await send('POST', BASE, 'flagged.test', body);
    expect(moved.json().data.id).not.toBe(a!.json().data.id);
  });

  it('без флага, чужой, отправленный, плохое тело и сбой модели — отказ', async () => {
    const { draft, send, writer } = await setup();
    const id = (await draft()).json().data.id as string;
    const url = `${BASE}/${id}/variants`;
    const calls = writer.calls.length;
    for (const user of ['plain.test', 'other.test'] as const) {
      expect((await send('POST', url, user, {})).statusCode).toBe(404);
    }
    expect((await send('POST', url, undefined, {})).statusCode).toBe(404);
    expect((await send('POST', url, 'flagged.test', { wish: { chips: ['louder'] } })).statusCode).toBe(400);
    expect(writer.calls).toHaveLength(calls);
    writer.body = undefined;
    expect((await send('POST', url, 'flagged.test', {})).statusCode).toBe(503);
    expect((await send('GET', list(id), 'flagged.test')).json().data.variants).toEqual([]);
    await send('POST', `${BASE}/${id}/approve`, 'flagged.test');
    await send('POST', `${BASE}/${id}/sent`, 'flagged.test');
    expect((await send('POST', url, 'flagged.test', {})).statusCode).toBe(409);
  });
});

describe('B753: «Не отправлять»', () => {
  it('убирает черновик с вариантами; следующий — новый; чужой и отправленный не трогает', async () => {
    const { draft, send, writer } = await setup();
    const id = (await draft()).json().data.id as string;
    writer.body = 'Анна, привет! Давно не общались. Расскажешь, как устроена команда данных?';
    expect((await send('POST', `${BASE}/${id}/variants`, 'flagged.test', {})).statusCode).toBe(201);
    for (const user of ['plain.test', 'other.test'] as const) {
      expect((await send('DELETE', `${BASE}/${id}`, user)).statusCode).toBe(404);
    }
    expect((await send('DELETE', `${BASE}/${id}`, 'flagged.test')).statusCode).toBe(204);
    expect((await send('DELETE', `${BASE}/${id}`, 'flagged.test')).statusCode).toBe(404);
    const list = await send('GET', `/api/v1/candidate/text-variants?kind=message&subjectId=${id}`, 'flagged.test');
    expect(list.json().data?.variants ?? []).toEqual([]);
    const next = await draft();
    expect(next.statusCode).toBe(201);
    const nextId = next.json().data.id as string;
    expect(nextId).not.toBe(id);
    await send('POST', `${BASE}/${nextId}/approve`, 'flagged.test');
    await send('POST', `${BASE}/${nextId}/sent`, 'flagged.test');
    expect((await send('DELETE', `${BASE}/${nextId}`, 'flagged.test')).statusCode).toBe(409);
  });
});

describe('B753: своя цепочка сообщения', () => {
  it('черновик пишет писатель сообщений, писатель письма не вызывается', async () => {
    const letter = stubWriter('Письмо работодателю');
    const contact = stubWriter('Анна, привет! Давно не общались. Расскажешь, как устроена команда данных?');
    const h = await createB640Harness({ pool: () => [], coverLetterWriter: letter, contactMessageWriter: contact });
    closers.push(h.close);
    const own = h.candidateIds['flagged.test'];
    h.candidates.saveResumeDraft(own, { ...EMPTY_RESUME_DRAFT, targetRole: 'Директор по данным',
      candidate: { ...EMPTY_RESUME_DRAFT.candidate, fullName: 'Пётр Сидоров', headline: 'Руководитель аналитики' } }, []);
    const headers = { authorization: `Bearer ${h.tokens['flagged.test']}`, origin: 'http://localhost:3000' };
    await h.app.inject({ method: 'PUT', url: `${OLD}/anna`, headers,
      payload: { fullName: 'Анна Ким', companyName: 'Альфа', roleTitle: 'Рекрутер', relationship: 'Коллега', strength: 'strong' } });
    const res = await h.app.inject({ method: 'POST', url: BASE, headers, payload: { contactId: 'anna', kind: 'known_contact' } });
    expect(res.json().data.text).toContain('Давно не общались');
    expect(contact.calls).toHaveLength(1);
    expect(letter.calls).toHaveLength(0);
    const review = contact.calls[0]?.review;
    // Длинный текст первая проверка пропускает: его сокращает та же модель (решение CPO 23.11).
    expect(review?.('Анна, привет! ' + 'а'.repeat(700))).toEqual([]);
    expect(review?.('Анна, привет! Откликаюсь на вакансию в Альфа.')).toEqual(['contact_response_formula']);
    expect(review?.('Анна, привет! Давно не общались.')).toEqual([]);
  });
});

describe('B753: сокращение и роли по-русски', () => {
  type Cluster = { canonicalTitle: string; canonicalCompany: string; descriptionSummary?: string; canonicalLocation?: string };
  async function harness(bodies: string[], targetRole = 'Директор по данным', headline = 'Руководитель аналитики', cluster?: Cluster) {
    const calls: CoverLetterWriteInput[] = [];
    const contact: CoverLetterWriter = {
      async writeCoverLetter(input) {
        calls.push(input);
        const body = bodies.shift();
        return body ? { body, stage: 'stub' } : { stage: 'stub', failure: { stage: 'stub', kind: 'timeout' } };
      },
    };
    const h = await createB640Harness({
      pool: () => [], contactMessageWriter: contact, ...(cluster ? { engine: { getActiveCluster: () => cluster } } : {}),
    });
    closers.push(h.close);
    h.candidates.saveResumeDraft(h.candidateIds['flagged.test'], { ...EMPTY_RESUME_DRAFT, targetRole,
      candidate: { ...EMPTY_RESUME_DRAFT.candidate, fullName: 'Пётр Сидоров', headline } }, []);
    const headers = { authorization: `Bearer ${h.tokens['flagged.test']}`, origin: 'http://localhost:3000' };
    await h.app.inject({ method: 'PUT', url: `${OLD}/anna`, headers,
      payload: { fullName: 'Анна Ким', companyName: 'Альфа', roleTitle: 'Рекрутер', relationship: 'Коллега', strength: 'strong' } });
    const payload = { contactId: 'anna', kind: 'known_contact', ...(cluster ? { vacancyId: 'cluster-src-x:1' } : {}) };
    const post = async () => (await h.app.inject({ method: 'POST', url: BASE, headers, payload })).json().data.text as string;
    return { calls, post };
  }

  it('без вакансии текст «по поводу открытой вакансии» не принимается — шаблон без вакансии', async () => {
    const { post } = await harness(['Анна, здравствуйте! Пишу по поводу открытой вакансии в Альфа.', 'Анна, здравствуйте! Пишу по поводу вакансии.']);
    expect(await post()).not.toMatch(/ваканси/iu);
  });

  it('язык: английская вакансия — английский черновик, русская — русский', async () => {
    const en = await harness(['Hello Anna! Happy to discuss.'], 'CTO', 'CTO', {
      canonicalTitle: 'Senior Lead AI Engineer', canonicalCompany: 'Capital One',
      descriptionSummary: 'We are looking for a lead engineer to build agentic AI platform services.', canonicalLocation: 'McLean, VA, United States',
    });
    await en.post();
    expect(en.calls[0]?.chosenLanguage).toBe('en');
    const ru = await harness(['Анна, здравствуйте!'], 'CTO', 'CTO', {
      canonicalTitle: 'Директор по кредитным продуктам (CPO)', canonicalCompany: 'СБЕР',
      descriptionSummary: 'Ищем руководителя кредитных продуктов.', canonicalLocation: 'Москва',
    });
    await ru.post();
    expect(ru.calls[0]?.chosenLanguage).toBe('ru');
  });

  it('длинный текст — та же модель сокращает свой текст, шаблон не нужен', async () => {
    const long = `Анна, привет! Давно не общались. ${'Очень длинное пояснение. '.repeat(30)}`;
    const { calls, post } = await harness([long, 'Анна, привет! Давно не общались. Расскажешь о команде данных?']);
    expect(await post()).toBe('Анна, привет! Давно не общались. Расскажешь о команде данных?');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.correction).toContain('Сократи');
    expect(calls[1]?.correction).toContain(long.trim().slice(0, 40));
  });

  it('профиль идёт к модели как есть; целевые роли — отдельной строкой по-русски; английская целевая роль — повтор', async () => {
    const { calls, post } = await harness(['Анна, привет! Давно не общались.'], 'Chief Operating Officer', 'Chief Operating Officer в Альфа');
    await post();
    expect(calls[0]?.profile).toContain('Chief Operating Officer в Альфа');
    expect(calls[0]?.wish).toContain('«Операционный директор»');
    expect(calls[0]?.review?.('Анна, привет! Ищу роль Chief Operating Officer.')).toEqual(['contact_english_role']);
    expect(calls[0]?.review?.('Анна, привет! Был Chief Operating Officer в Альфа.')).toEqual([]);
  });
});

describe('B698: черновик из карточки компании — о самой компании', () => {
  const TITLES: Record<string, string> = { c1: 'Директор по данным', c2: 'Руководитель отдела AI-трансформации аналитики' };
  async function companySetup(modelBody?: string, roleTitle = 'Head of Data') {
    const writer = stubWriter(modelBody);
    const h = await createB640Harness({
      pool: () => [poolItem({ id: 'c1', title: TITLES.c1!, company: 'VK' }), poolItem({ id: 'c2', title: TITLES.c2!, company: 'VK' })],
      coverLetterWriter: writer,
      engine: { getActiveCluster: (id: string) => (TITLES[id] ? { canonicalTitle: TITLES[id], canonicalCompany: 'VK' } : undefined) },
    });
    closers.push(h.close);
    h.candidates.saveResumeDraft(h.candidateIds['flagged.test'], { ...EMPTY_RESUME_DRAFT, targetRole: 'Директор по данным',
      candidate: { ...EMPTY_RESUME_DRAFT.candidate, fullName: 'Пётр Сидоров', headline: 'Руководитель аналитики' } }, []);
    const headers = { authorization: `Bearer ${h.tokens['flagged.test']}`, origin: 'http://localhost:3000' };
    await h.app.inject({ method: 'PUT', url: `${OLD}/alex`, headers,
      payload: { fullName: 'Alexandr Alexandrov', companyName: 'VK', roleTitle, relationship: 'Коллега', strength: 'strong' } });
    const post = (payload: object) => h.app.inject({ method: 'POST', url: BASE, headers, payload });
    return { h, writer, post };
  }

  it('в запросе к модели — компания, роль знакомого и обе вакансии; просьба — рекомендовать или представить', async () => {
    const { writer, post } = await companySetup('Александр, привет! Вижу у VK вакансию директора по данным. Подскажете, кто нанимает?');
    const res = await post({ contactId: 'alex', vacancyId: 'c1', alsoVacancyId: 'c2', kind: 'known_contact' });
    expect(res.statusCode).toBe(201);
    const input = writer.calls[0]!;
    expect(input.vacancy).toEqual({ title: TITLES.c1, company: 'VK' });
    for (const part of ['VK', 'Head of Data', TITLES.c1!, TITLES.c2!]) expect(input.wish).toContain(part);
    expect(input.wish).toMatch(/рекоменд|представ/iu);
    expect(input.wish).not.toContain('куда обратиться с поиском');
  });

  it('B753: в должности другая компания — запрос и текст только о своей; вопрос о чужой не принимается', async () => {
    const { writer, post } = await companySetup('Alexandr, здравствуйте! Подскажете, кто нанимает в Positive Technologies?', 'CPO @ Positive Technologies | ex Product Lead');
    const text = (await post({ contactId: 'alex', kind: 'known_contact' })).json().data.text as string;
    expect(text).not.toContain('Positive');
    expect(writer.calls[0]!.wish).not.toContain('Positive');
    expect(writer.calls[0]!.wish).toContain('CPO');
    expect(writer.calls[0]!.wish).toContain('Спрашивай только о компании VK');
  });

  it('B753: сохранённый черновик о другой компании не продолжается — пишется новый', async () => {
    const { h, writer, post } = await companySetup('Alexandr, здравствуйте! Подскажете, кто нанимает в VK?', 'CPO @ Positive Technologies');
    const store = new SqliteContactMessageRepository({ databasePath: h.databasePath });
    closers.unshift(async () => store.close());
    store.create({ id: 'old', candidateId: h.candidateIds['flagged.test'], contactId: 'alex', recruiterId: null, vacancyId: null,
      kind: 'known_contact', text: 'Привет! Как дела в Positive Technologies?', recipientName: 'Alexandr Alexandrov', recipientUrl: null,
      createdAt: '2026-11-20T00:00:00.000Z' });
    const first = await post({ contactId: 'alex', kind: 'known_contact' });
    expect(first.statusCode).toBe(201);
    expect(first.json().data.text).not.toContain('Positive');
    const calls = writer.calls.length;
    const again = await post({ contactId: 'alex', kind: 'known_contact' });
    expect([again.statusCode, again.json().data.id]).toEqual([200, first.json().data.id]);
    expect(writer.calls).toHaveLength(calls);
  });

  it('модель не ответила — запасной текст тоже про компанию и вакансию', async () => {
    const { post } = await companySetup(undefined);
    const text = (await post({ contactId: 'alex', vacancyId: 'c1', kind: 'known_contact' })).json().data.text as string;
    expect(text).toContain('VK');
    expect(text).toContain(TITLES.c1);
  });

  it('вторая вакансия другой компании (совпал id в источниках) в текст не попадает', async () => {
    const writer = stubWriter(undefined);
    const clusters: Record<string, { canonicalTitle: string; canonicalCompany: string }> = {
      c1: { canonicalTitle: TITLES.c1!, canonicalCompany: 'VK' },
      c9: { canonicalTitle: 'Customer Service - Sales - Housing', canonicalCompany: 'Tata Capital' },
    };
    const h = await createB640Harness({
      pool: () => [poolItem({ id: 'c1', title: TITLES.c1!, company: 'VK' })],
      coverLetterWriter: writer,
      engine: { getActiveCluster: (id: string) => clusters[id] },
    });
    closers.push(h.close);
    const headers = { authorization: `Bearer ${h.tokens['flagged.test']}`, origin: 'http://localhost:3000' };
    await h.app.inject({ method: 'PUT', url: `${OLD}/alex`, headers,
      payload: { fullName: 'Alexandr Alexandrov', companyName: 'VK', relationship: 'Коллега', strength: 'strong' } });
    const res = await h.app.inject({ method: 'POST', url: BASE, headers,
      payload: { contactId: 'alex', vacancyId: 'c1', alsoVacancyId: 'c9', kind: 'known_contact' } });
    const text = res.json().data.text as string;
    expect(text).toContain(TITLES.c1);
    expect(text).not.toContain('Customer Service');
    expect(text).toContain('открыта вакансия');
    expect(text).toContain('на эту роль');
  });

  it('две вакансии в запасном тексте — «на эти роли»', async () => {
    const { post } = await companySetup(undefined);
    const text = (await post({ contactId: 'alex', vacancyId: 'c1', alsoVacancyId: 'c2', kind: 'known_contact' })).json().data.text as string;
    expect(text).toContain('открыты вакансии');
    expect(text).toContain('на эти роли');
    expect(text).not.toContain('на эту роль');
  });

  it('вторая вакансия без первой и чужой формат id — 400', async () => {
    const { post } = await companySetup();
    expect((await post({ contactId: 'alex', alsoVacancyId: 'c2', kind: 'known_contact' })).statusCode).toBe(400);
    expect((await post({ contactId: 'alex', vacancyId: 'c1', alsoVacancyId: 'c 2', kind: 'known_contact' })).statusCode).toBe(400);
  });
});

describe('B698: правка, одобрение, отправка', () => {
  it('правит текст до 2000 знаков и только свой', async () => {
    const { send, draft } = await setup();
    const id = (await draft()).json().data.id as string;
    const put = await send('PUT', `${BASE}/${id}`, 'flagged.test', { text: 'Анна, привет! Короче.' });
    expect(put.json().data.text).toBe('Анна, привет! Короче.');
    expect((await send('PUT', `${BASE}/${id}`, 'flagged.test', { text: 'я'.repeat(2001) })).statusCode).toBe(400);
    expect((await send('PUT', `${BASE}/${id}`, 'flagged.test', { text: '  ' })).statusCode).toBe(400);
    expect((await send('PUT', `${BASE}/${id}`, 'other.test', { text: 'чужое' })).statusCode).toBe(404);
  });

  it('одобрение отдаёт openUrl только на linkedin.com, иначе null; отправка — после одобрения', async () => {
    const { send, draft, seed } = await setup();
    const id = (await draft()).json().data.id as string;
    expect((await send('POST', `${BASE}/${id}/sent`, 'flagged.test')).statusCode).toBe(409);
    const approved = await send('POST', `${BASE}/${id}/approve`, 'flagged.test');
    expect(approved.json().data).toMatchObject({ state: 'approved', openUrl: 'https://www.linkedin.com/in/anna-kim' });
    await seed('ivan', { fullName: 'Иван', companyName: 'Гамма' });
    const noUrl = (await send('POST', BASE, 'flagged.test', { contactId: 'ivan', kind: 'ask_introduction' })).json().data.id as string;
    expect((await send('POST', `${BASE}/${noUrl}/approve`, 'flagged.test')).json().data.openUrl).toBeNull();
  });

  it('«Отправил» пишет время и ставит контакту статус written; правка после отправки закрыта', async () => {
    const { send, draft } = await setup();
    const id = (await draft()).json().data.id as string;
    await send('POST', `${BASE}/${id}/approve`, 'flagged.test');
    const sent = await send('POST', `${BASE}/${id}/sent`, 'flagged.test');
    expect(sent.statusCode).toBe(200);
    expect(sent.json().data).toMatchObject({ state: 'sent' });
    expect(Date.parse(sent.json().data.sentAt)).not.toBeNaN();
    const list = (await send('GET', `${CONTACTS}?status=written`, 'flagged.test')).json();
    expect(list.data.items.map((item: { id: string }) => item.id)).toEqual(['anna']);
    expect((await send('PUT', `${BASE}/${id}`, 'flagged.test', { text: 'позже' })).statusCode).toBe(409);
    expect((await send('POST', `${BASE}/${id}/sent`, 'other.test')).statusCode).toBe(404);
  });

  it('GET отдаёт последние сообщения контакту только кандидата сессии', async () => {
    const { send, draft } = await setup();
    await draft();
    await send('POST', BASE, 'flagged.test', { contactId: 'anna', kind: 'ask_introduction' });
    const list = (await send('GET', `${BASE}?contactId=anna`, 'flagged.test')).json();
    expect(list.data.items).toHaveLength(2);
    expect(list.data.items[0].kind).toBe('ask_introduction');
    expect((await send('GET', `${BASE}?contactId=anna`, 'other.test')).json().data.items).toEqual([]);
    expect((await send('GET', BASE, 'flagged.test')).statusCode).toBe(400);
  });
});

describe('B698: отправленные по вакансии — для «Что было» в отклике', () => {
  it('GET /sent?vacancyId= отдаёт только отправленные этой вакансии и только своему кандидату, без текста', async () => {
    const { send, draft, seed } = await setup();
    const sentId = (await draft({ contactId: 'anna', vacancyId: 'c1', kind: 'known_contact' })).json().data.id as string;
    await send('POST', `${BASE}/${sentId}/approve`, 'flagged.test');
    await send('POST', `${BASE}/${sentId}/sent`, 'flagged.test');
    await seed('ivan', { fullName: 'Иван Петров', companyName: 'Гамма' });
    await send('POST', BASE, 'flagged.test', { contactId: 'ivan', vacancyId: 'c1', kind: 'ask_introduction' });
    const list = await send('GET', `${BASE}/sent?vacancyId=c1`, 'flagged.test');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items).toEqual([
      { id: sentId, kind: 'known_contact', recipientName: 'Анна Ким', sentAt: expect.any(String) },
    ]);
    expect((await send('GET', `${BASE}/sent?vacancyId=c2`, 'flagged.test')).json().data.items).toEqual([]);
    expect((await send('GET', `${BASE}/sent?vacancyId=c1`, 'other.test')).json().data.items).toEqual([]);
    expect((await send('GET', `${BASE}/sent`, 'flagged.test')).statusCode).toBe(400);
    expect((await send('GET', `${BASE}/sent?vacancyId=a%20b`, 'flagged.test')).statusCode).toBe(400);
  });

  it('id вакансии с двоеточием, как у кластеров hh (`cluster-src-hh-search:137412812`), принимается', async () => {
    const { send, draft } = await setup();
    const vacancyId = 'cluster-src-hh-search:137412812';
    const created = await draft({ contactId: 'anna', vacancyId, kind: 'known_contact' });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    await send('POST', `${BASE}/${id}/approve`, 'flagged.test');
    await send('POST', `${BASE}/${id}/sent`, 'flagged.test');
    const list = await send('GET', `${BASE}/sent?vacancyId=${encodeURIComponent(vacancyId)}`, 'flagged.test');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items.map((item: { id: string }) => item.id)).toEqual([id]);
  });
});
