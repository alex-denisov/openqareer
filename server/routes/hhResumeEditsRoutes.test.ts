import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import { cluster } from '../testHelpers/letterApprovalHarness';
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

async function harness(cabinetB640 = true) {
  const { app, candidates } = await createApp([cluster], { cabinetB640 });
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
  const call = (method: 'GET' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload ? { payload } : {}) });
  return { call };
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

  it('у резюме без разделов (прежний снимок) правок нет — просим выбрать его заново', async () => {
    const { call } = await harness();
    const { sections: _sections, ...plain } = SNAPSHOT.selected;
    await call('PUT', RESUMES, { ...SNAPSHOT, selected: plain });
    const response = await call('GET', EDITS);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('hh_resume_sections_missing');
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
