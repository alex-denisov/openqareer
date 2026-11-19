import { afterEach, describe, expect, it } from 'vitest';
import type { CoverLetterWriteInput, CoverLetterWriter } from '../providers/coverLetterWriter';
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
  const send = (method: 'GET' | 'PUT' | 'POST', url: string, user?: HarnessUser, payload?: object) =>
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
    for (const [method, url] of [['POST', BASE], ['GET', `${BASE}?contactId=a`], ['PUT', `${BASE}/x`], ['POST', `${BASE}/x/approve`], ['POST', `${BASE}/x/sent`]] as const) {
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
