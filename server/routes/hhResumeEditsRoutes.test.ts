import { describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import { cluster } from '../testHelpers/letterApprovalHarness';
import { MultiSourceVacancyEngine } from '../vacancies/multiSourceVacancyEngine';
import { createApp, login } from '../testHelpers/vacancyPitchHarness';

/** B678: правки резюме hh.ru «было → станет» по профилю платформы (cluster-99: Node.js, TypeScript, Kubernetes, PostgreSQL). */
const RESUMES = '/api/v1/candidate/hh/resumes';
const EDITS = `${RESUMES}/edits?vacancyId=cluster-99`;
const ORIGIN = 'http://localhost:3000';

const SECTIONS = {
  title: 'Разработчик',
  about: '',
  skills: ['Node.js'],
  places: [{ employer: 'ООО Финтех Лаб', title: 'Разработчик', period: 'янв 2021 — н.в.', text: 'Писал сервисы.' }],
};
const SNAPSHOT = {
  resumes: [{ id: 'dev', title: 'Разработчик' }],
  selected: { id: 'dev', title: 'Разработчик', text: 'Разработчик. Node.js. Писал сервисы.', sections: SECTIONS },
};

async function harness(
  cabinetB640 = true,
  hhResumeVariant?: (input: { facts: readonly { text: string }[] }) => Promise<unknown>,
) {
  const { app, candidates } = await createApp([cluster], {
    cabinetB640,
    ...(hhResumeVariant ? { experienceFactRewriter: { rewrite: async () => null, hhResumeVariant } as never } : {}),
  });
  const { cookie, candidateId } = await login(app);
  const ids = ['import:b678:role', 'import:b678:b1', 'import:b678:b2'];
  candidates.importResumeEvidence(candidateId, {
    sourceLabel: 'synthetic',
    entries: [
      { memoryId: ids[0], domain: 'role-evidence', statement: 'Разработчик, Финтех Лаб, с 2021 года.' },
      { memoryId: ids[1], domain: 'outcome', statement: 'Перевёл сервисы платежей на Kubernetes.' },
      { memoryId: ids[2], domain: 'responsibility', statement: 'Вёл базу PostgreSQL платёжного шлюза.' },
    ],
  } as never);
  candidates.reviewMemories(candidateId, ids, 'confirm');
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    candidate: { fullName: 'Мила Пример' },
    experience: [{
      id: 'exp-1', chronologyMemoryId: ids[0]!, title: 'Разработчик', employer: 'Финтех Лаб',
      startDate: '2021-01', current: true, bulletMemoryIds: [ids[1]!, ids[2]!],
    }],
  };
  candidates.saveResumeDraft(candidateId, draft, []);
  const call = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload ? { payload } : {}) });
  return { call, candidates, candidateId };
}

describe('B678: правки резюме hh.ru «было → станет»', () => {
  it('опыт по месту работы и недостающие навыки берутся из подтверждённого профиля', async () => {
    const { call } = await harness();
    expect((await call('PUT', RESUMES, SNAPSHOT)).statusCode).toBe(200);

    const response = await call('GET', EDITS);
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.resumeId).toBe('dev');
    const experience = data.edits.find((edit: { section: string }) => edit.section === 'experience');
    expect(experience).toMatchObject({ place: 'ООО Финтех Лаб · янв 2021 — н.в.', was: 'Писал сервисы.' });
    expect(experience.now).toContain('Перевёл сервисы платежей на Kubernetes.');
    const skills = data.edits.find((edit: { section: string }) => edit.section === 'skills');
    expect(skills.now).toBe('Node.js, Kubernetes, PostgreSQL');
    expect(skills.added).toEqual(['Kubernetes', 'PostgreSQL']);
    expect(data.edits.find((edit: { section: string }) => edit.section === 'title').now).toBe('Senior Platform Engineer');
  });

  it('отклик сохранён под другим названием — должность и навыки чужой вакансии не предлагаются', async () => {
    const { call, candidates, candidateId } = await harness();
    candidates.createApplication(candidateId, {
      clusterId: 'cluster-99',
      stage: 'saved',
      manualVacancy: { title: 'Head of DevOps', company: 'Пример', url: 'https://example.test/1', source: 'getmatch' },
    });
    await call('PUT', RESUMES, SNAPSHOT);
    const { data } = (await call('GET', EDITS)).json();
    expect(data.edits.some((edit: { section: string }) => ['title', 'skills'].includes(edit.section))).toBe(false);
  });

  it('на вакансию hh.ru с другим названием отклик не уходит', async () => {
    const { call } = await harness();
    await call('PUT', RESUMES, SNAPSHOT);
    const read = vi
      .spyOn(MultiSourceVacancyEngine.prototype, 'getVacancy')
      .mockImplementation((id) => (id === 'src-hh-search:777' ? ({ title: 'Receptionist' } as never) : undefined));
    const send = (vacancyTitle: string) =>
      call('POST', '/api/v1/candidate/hh/applications', { vacancyId: '777', resumeId: 'dev', confirmed: true, vacancyTitle });
    const refused = await send('Head of DevOps');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('hh_vacancy_mismatch');
    expect((await send('Receptionist')).statusCode).toBe(201);
    read.mockRestore();
  });

  it('у резюме без разделов (прежний снимок) правок нет — просим выбрать его заново', async () => {
    const { call } = await harness();
    const { sections: _sections, ...plain } = SNAPSHOT.selected;
    await call('PUT', RESUMES, { ...SNAPSHOT, selected: plain });
    const response = await call('GET', EDITS);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('hh_resume_sections_missing');
  });

  it('разделы выбранного прочитаны при сверке списка — правки есть без нового выбора', async () => {
    const { call } = await harness();
    const { sections, ...plain } = SNAPSHOT.selected;
    const saved = await call('PUT', RESUMES, { ...SNAPSHOT, selected: plain, contents: [{ ...plain, sections }] });
    expect(saved.statusCode).toBe(200);
    expect((await call('GET', EDITS)).statusCode).toBe(200);
  });

  it('сверка отдаёт у прочитанного резюме то же число правок, что откроет разбор', async () => {
    const { call } = await harness();
    const other = { id: 'other', title: 'Другое', text: 'Текст' };
    await call('PUT', RESUMES, {
      resumes: [...SNAPSHOT.resumes, { id: 'other', title: 'Другое' }],
      selected: other,
      contents: [SNAPSHOT.selected],
    });
    const review = (await call('GET', `${RESUMES}/review?vacancyId=cluster-99&edits=1`)).json().data;
    const plain = (await call('GET', `${RESUMES}/review?vacancyId=cluster-99`)).json().data;
    expect(plain.resumes[0]).not.toHaveProperty('editCount');
    await call('PUT', RESUMES, SNAPSHOT);
    const edits = (await call('GET', EDITS)).json().data.edits;
    const fits = review.resumes as Array<{ resumeId: string; editCount?: number }>;
    expect(edits.length).toBeGreaterThan(0);
    expect(fits.find((fit) => fit.resumeId === 'dev')?.editCount).toBe(edits.length);
    expect(fits.find((fit) => fit.resumeId === 'other')).not.toHaveProperty('editCount');
  });

  it('разделы проверяются по размеру', async () => {
    const { call } = await harness();
    const huge = { ...SECTIONS, about: 'я'.repeat(4_001) };
    const response = await call('PUT', RESUMES, { ...SNAPSHOT, selected: { ...SNAPSHOT.selected, sections: huge } });
    expect(response.statusCode).toBe(400);
  });

  it('без флага B640 — 404', async () => {
    const { call } = await harness(false);
    expect((await call('GET', EDITS)).statusCode).toBe(404);
  });

  it('снимок с разделами и текстами пяти резюме кириллицей укладывается в предел тела запроса', async () => {
    const { call } = await harness();
    const text = 'я'.repeat(8_000);
    const resumes = Array.from({ length: 5 }, (_, index) => ({ id: `r${index}`, title: `Резюме ${index}` }));
    const places = Array.from({ length: 30 }, () => ({ employer: 'Компания', title: 'Должность', period: '2020 — 2021', text: 'я'.repeat(4_000) }));
    const response = await call('PUT', RESUMES, {
      resumes,
      selected: { id: 'r0', title: 'Резюме 0', text, sections: { ...SECTIONS, about: 'я'.repeat(4_000), places } },
      contents: resumes.map((resume) => ({ ...resume, text })),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('B682: «Другой вариант» правки резюме', () => {
  const VARIANTS = `${RESUMES}/edits/variants`;
  type Edit = { section: string; now: string; variantOf?: { vacancyId: string; subjectId: string } };
  async function opened(answers: readonly string[]) {
    const queue = [...answers];
    const write = vi.fn(async () => ({ text: queue.shift() ?? '', factIds: [] }));
    const { call } = await harness(true, write);
    await call('PUT', RESUMES, SNAPSHOT);
    const edits = (await call('GET', EDITS)).json().data.edits as Edit[];
    return { call, write, edits, skills: edits.find((edit) => edit.section === 'skills')! };
  }

  it('три варианта навыков, четвёртый — 409 без модели; список переживает перезагрузку; у должности ключа нет', async () => {
    const { call, write, edits, skills } = await opened(['Kubernetes\nNode.js', 'PostgreSQL\nNode.js', 'PostgreSQL\nKubernetes\nNode.js']);
    expect(edits.find((edit) => edit.section === 'title')?.variantOf).toBeUndefined();
    const first = await call('POST', VARIANTS, skills.variantOf);
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ remaining: 2, variant: { text: 'Kubernetes, Node.js', payload: { added: ['Kubernetes'] } } });
    for (let i = 0; i < 2; i += 1) expect((await call('POST', VARIANTS, skills.variantOf)).statusCode).toBe(201);
    const over = await call('POST', VARIANTS, skills.variantOf);
    expect([over.statusCode, over.json().error.code]).toEqual([409, 'variant_limit_reached']);
    expect(write).toHaveBeenCalledTimes(3);
    const list = await call('GET', `/api/v1/candidate/text-variants?kind=resume&subjectId=${skills.variantOf!.subjectId}`);
    expect(list.json().data).toMatchObject({ remaining: 0 });
  });

  it('новый навык — 503 и не сохраняется; чужой ключ — 404, мусор — 400, модель не зовётся', async () => {
    const { call, write, skills } = await opened(['Rust\nNode.js']);
    expect((await call('POST', VARIANTS, skills.variantOf)).statusCode).toBe(503);
    expect((await call('POST', VARIANTS, { vacancyId: 'cluster-99', subjectId: 'a'.repeat(64) })).statusCode).toBe(404);
    expect((await call('POST', VARIANTS, { vacancyId: 'cluster-99', subjectId: 'x' })).statusCode).toBe(400);
    expect((await call('POST', VARIANTS, { ...skills.variantOf, vacancyId: 'cluster-0' })).statusCode).toBe(404);
    expect(write).toHaveBeenCalledTimes(3); // B682: два повтора с причиной
    expect((write.mock.calls as unknown[][])[1]![0]).toMatchObject({ rejected: { text: 'Rust\nNode.js', reason: expect.any(String) } });
  });

  it('пять неудач за час — 429 без вызова модели', async () => {
    const { call, write, skills } = await opened([]);
    for (let i = 0; i < 5; i += 1) expect((await call('POST', VARIANTS, skills.variantOf)).statusCode).toBe(503);
    expect((await call('POST', VARIANTS, skills.variantOf)).statusCode).toBe(429);
    expect(write).toHaveBeenCalledTimes(15); // B682: по три попытки на запрос
  });

  it('без флага B640 — 404', async () => {
    const { call } = await harness(false);
    expect((await call('POST', VARIANTS, { vacancyId: 'cluster-99', subjectId: 'a'.repeat(64) })).statusCode).toBe(404);
  });
});
