import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { seedResume, setup } from './testHelpers/letterApprovalHarness';

describe('B601: одобрение письма прикладывает резюме под вакансию', () => {
  it('снимок резюме под вакансию привязан к заявке вместе с письмом, ничего не отправлено', async () => {
    const { candidates, candidateId, approve, linkedResume } = await setup('Head of Platform');
    const response = await approve();
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data).toMatchObject({ status: 'approved', sent: false });
    expect(data.resume).toMatchObject({ kind: 'targeted', versionId: expect.any(String), documentId: expect.any(String) });
    expect(Number.isNaN(Date.parse(data.resume.snapshotAt))).toBe(false);

    const application = candidates.getApplication(candidateId, data.applicationId);
    expect(application?.materials).toEqual({ coverLetter: true, resume: true });
    expect(linkedResume(data.applicationId))
      .toBe(data.resume.documentId);

    const document = candidates.getDocument(candidateId, data.resume.documentId);
    expect(document).toMatchObject({ kind: 'resume', source: 'generated', parseStatus: 'not_applicable' });
    const content = JSON.parse(Buffer.from(document!.contentBase64, 'base64').toString('utf8'));
    expect(content).toMatchObject({
      version: 1,
      resumeVersionId: data.resume.versionId,
      vacancyId: 'cluster-99',
      applicationId: data.applicationId,
      sent: false,
    });
    expect(content.snapshot.document.experience).toHaveLength(1);

    const version = candidates.getResumeVersion(candidateId, data.resume.versionId);
    expect(version).toMatchObject({ status: 'approved', title: 'Senior Platform Engineer' });
  });

  it('повторное одобрение не плодит ни документов, ни версий, ни привязок', async () => {
    const { approve, resumeDocuments, versions } = await setup('Head of Platform');
    const first = (await approve()).json().data;
    const second = (await approve()).json().data;
    expect(second.applicationId).toBe(first.applicationId);
    expect(second.resume.documentId).toBe(first.resume.documentId);
    expect(second.resume.versionId).toBe(first.resume.versionId);
    expect(resumeDocuments()).toHaveLength(1);
    expect(versions()).toHaveLength(1);
  });

  it('мастер-резюме изменилось: новый снимок заменяет прежний в заявке', async () => {
    const { candidates, candidateId, approve, versions, linkedResume } = await setup('Head of Platform');
    const first = (await approve()).json().data;
    seedResume(candidates, candidateId, 'VP Platform Engineering');
    const second = (await approve()).json().data;
    expect(second.resume.versionId).not.toBe(first.resume.versionId);
    expect(linkedResume(second.applicationId))
      .toBe(second.resume.documentId);
    expect(versions()).toHaveLength(2);
  });

  it('резюме нет: письмо одобрено, резюме не привязано, ответ это говорит', async () => {
    const { candidates, candidateId, approve, resumeDocuments, versions } = await setup();
    const response = await approve();
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.resume).toBeNull();
    expect(candidates.getApplication(candidateId, data.applicationId)?.materials.resume).toBe(false);
    expect(resumeDocuments()).toHaveLength(0);
    expect(versions()).toHaveLength(0);
  });

  it('черновик письма говорит экрану, есть ли резюме для приложения', async () => {
    expect((await (await setup('Head of Platform')).pitch()).json().data.resumeAvailable).toBe(true);
    expect((await (await setup()).pitch()).json().data.resumeAvailable).toBe(false);
  });
});

describe('B785: резюме отправленного отклика', () => {
  it('после отправки версия не меняется и отклик не открывается заново', async () => {
    const { call, candidates, candidateId, approve, prepareResume, versions, linkedResume, resumeDocuments } =
      await setup('Head of Platform');
    const first = (await approve()).json().data;
    const sent = candidates.getApplication(candidateId, first.applicationId)!;
    const marked = await call('PATCH', '/api/v1/candidate/applications/' + sent.id, {
      expectedVersion: sent.version,
      stage: 'applied',
    });
    expect(marked.statusCode).toBe(200);
    // Профиль, а с ним и разбор изменились: id версии был бы другим.
    seedResume(candidates, candidateId, 'VP Platform Engineering');
    expect((await prepareResume()).json().data.versionId).toBe(first.resume.versionId);
    const again = await approve();
    expect(again.statusCode).toBe(200);
    expect(again.json().data.resume).toMatchObject({
      versionId: first.resume.versionId,
      documentId: first.resume.documentId,
    });
    expect(linkedResume(first.applicationId)).toBe(first.resume.documentId);
    expect(versions()).toHaveLength(1);
    expect(resumeDocuments()).toHaveLength(1);
    const after = candidates.listApplications(candidateId);
    expect(after.map(({ id, stage }) => [id, stage])).toEqual([[first.applicationId, 'applied']]);
  });
});

describe('hasAttachableResume', () => {
  it('место работы без подтверждённого факта не делает резюме: в снимке его нет', async () => {
    const { candidates, candidateId, approve } = await setup();
    candidates.saveResumeDraft(candidateId, {
      ...EMPTY_RESUME_DRAFT,
      candidate: { fullName: 'Мила Пример' },
      experience: [{ id: 'exp-1', chronologyMemoryId: 'mem-x', title: 'CTO', current: true, bulletMemoryIds: [] }],
    }, []);
    expect((await approve()).json().data.resume).toBeNull();
  });
});

describe('B601: возврат к прежнему резюме', () => {
  it('резюме вернулось к прежнему виду: заявка получает этот снимок снова, а не остаётся с промежуточным', async () => {
    const { candidates, candidateId, approve, linkedResume } = await setup('Head of Platform');
    const first = (await approve()).json().data;
    seedResume(candidates, candidateId, 'VP Platform Engineering');
    const middle = (await approve()).json().data;
    seedResume(candidates, candidateId, 'Head of Platform');
    const back = (await approve()).json().data;
    expect(middle.resume.versionId).not.toBe(first.resume.versionId);
    expect(linkedResume(back.applicationId)).toBe(back.resume.documentId);
    expect(back.resume.documentId).not.toBe(middle.resume.documentId);
  });
});

describe('B785: правки резюме под вакансию', () => {
  const PATH = '/api/v1/candidate/vacancies/cluster-99/resume-edits';

  const BULLETS = ['Вела бэкенд и релизы команды', 'Перевела платформу на Kubernetes, 2024'];

  it('правка видна, отменяется, меняется без новых чисел и уходит в одобренное резюме', async () => {
    const { call, candidates, candidateId, approve, prepareResume } = await setup();
    seedResume(candidates, candidateId, 'Head of Platform', BULLETS);
    const [edit] = (await call('GET', PATH)).json().data.edits;
    expect(edit).toMatchObject({ text: BULLETS[1], why: 'Kubernetes', cancelled: false });
    const first = async () => {
      const id = (await prepareResume()).json().data.versionId;
      const version = candidates.getResumeVersion(candidateId, id);
      return (version?.snapshot as unknown as { document: { experience: Array<{ bullets: Array<{ value: string }> }> } })
        .document.experience[0]!.bullets[0]!.value;
    };
    expect(await first()).toBe(BULLETS[1]);
    expect((await call('PUT', PATH, { action: 'cancel', id: edit.id })).json().data.edits[0].cancelled).toBe(true);
    expect(await first()).toBe(BULLETS[0]);
    expect((await call('PUT', PATH, { action: 'text', id: edit.id, text: 'Ускорила на 30%' })).statusCode).toBe(422);
    const text = 'Kubernetes в 2024: перевела платформу';
    expect((await call('PUT', PATH, { action: 'text', id: edit.id, text })).statusCode).toBe(200);
    expect(await first()).toBe(text);
    const approved = (await approve()).json().data.resume;
    expect(JSON.stringify(candidates.getResumeVersion(candidateId, approved.versionId)?.snapshot)).toContain(text);
    expect(candidates.exportCandidate(candidateId).content.resumeEdits).toEqual([
      { vacancyId: 'cluster-99', choices: { cancelled: [], texts: { [edit.id]: text } } },
    ]);
    expect((await call('PUT', PATH, { action: 'cancel', id: 'нет' })).statusCode).toBe(409);
    expect((await call('PUT', PATH, { action: 'other', id: 'x' })).statusCode).toBe(400);
  });

  it('RU/EN: перевод входит в версию, сбой перевода язык не меняет, назад — без модели', async () => {
    let works = false;
    const translate = async ({ bullets }: { bullets: ReadonlyArray<{ key: string; text: string }> }) =>
      works ? { bullets: bullets.map(({ key, text }) => ({ key, text: 'The platform was moved to Kubernetes' + (text.includes('2024') ? ', 2024' : '') })) } : null;
    const { call, candidates, candidateId, approve, prepareResume } = await setup(undefined, {
      experienceFactRewriter: { translate, rewrite: async () => null } as never,
    });
    seedResume(candidates, candidateId, 'Head of Platform', BULLETS);
    const snapshot = async () => {
      const id = (await prepareResume()).json().data.versionId;
      return JSON.stringify(candidates.getResumeVersion(candidateId, id)?.snapshot.document.experience);
    };
    const russian = await snapshot();
    expect((await call('GET', PATH)).json().data.lang).toBe('ru');
    expect((await call('PUT', PATH, { action: 'lang', lang: 'en' })).statusCode).toBe(503);
    expect((await call('GET', PATH)).json().data.lang).toBe('ru');
    expect(await snapshot()).toBe(russian);
    works = true;
    expect((await call('PUT', PATH, { action: 'lang', lang: 'en' })).json().data.lang).toBe('en');
    expect(await snapshot()).not.toMatch(/Перевела|Вела|Финтех/u);
    const { versionId } = (await approve()).json().data.resume;
    expect(JSON.stringify(candidates.getResumeVersion(candidateId, versionId)?.snapshot)).toContain('moved to Kubernetes, 2024');
    works = false;
    expect((await call('PUT', PATH, { action: 'lang', lang: 'ru' })).json().data.lang).toBe('ru');
    expect(await snapshot()).toBe(russian);
  });

  it('RU/EN: более длинный перевод не теряет пунктов при подгонке под две страницы', async () => {
    const translate = async ({ bullets }: { bullets: ReadonlyArray<{ key: string; text: string }> }) => ({
      bullets: bullets.map(({ key, text }) => ({
        key,
        text: `The support service moved to the new platform with ${/\d+/u.exec(text)?.[0]} regional teams across the whole country on schedule`,
      })),
    });
    const { call, candidates, candidateId, prepareResume } = await setup(undefined, {
      experienceFactRewriter: { translate, rewrite: async () => null } as never,
    });
    const bullets = Array.from({ length: 50 }, (_, index) => `Сервис поддержки перешёл на платформу, регион номер ${index + 100}`);
    seedResume(candidates, candidateId, 'Head of Platform', bullets);
    const count = async () => {
      const id = (await prepareResume()).json().data.versionId;
      return candidates.getResumeVersion(candidateId, id)?.snapshot.document.experience[0]?.bullets.length;
    };
    const russian = await count();
    expect(russian).toBeGreaterThan(20);
    expect((await call('PUT', PATH, { action: 'lang', lang: 'en' })).statusCode).toBe(200);
    expect(await count()).toBe(russian);
  });
});

describe('отклик на hh.ru: уходит резюме hh.ru', () => {
  const vacancy = { primaryUrl: 'https://hh.ru/vacancy/135330911' };

  it('своё резюме не собирается, правок нет, к письму ничего не приложено', async () => {
    const { approve, call, prepareResume, resumeDocuments, versions } = await setup('Head of Platform', { vacancy });
    expect((await prepareResume()).json().data).toMatchObject({ ready: false, versionId: null });
    expect((await call('GET', '/api/v1/candidate/vacancies/cluster-99/resume-edits')).json().data).toEqual({ edits: [], lang: null });
    const response = await approve();
    expect(response.statusCode).toBe(200);
    expect(response.json().data.resume).toBeNull();
    expect(resumeDocuments()).toHaveLength(0);
    expect(versions()).toHaveLength(0);
  });
});

describe('язык резюме по умолчанию — язык вакансии', () => {
  const PATH = '/api/v1/candidate/vacancies/cluster-99/resume-edits';
  const vacancy = { descriptionSummary: 'Platform engineering with Node.js and Kubernetes' };
  const translate = async ({ bullets }: { bullets: ReadonlyArray<{ key: string; text: string }> }) => ({
    bullets: bullets.map(({ key }) => ({ key, text: 'The platform was moved to Kubernetes' })),
  });

  it('русский профиль, английская вакансия — английский текст; переключатель возвращает русский', async () => {
    const { call, candidates, candidateId, prepareResume } = await setup(undefined, {
      vacancy,
      experienceFactRewriter: { translate, rewrite: async () => null } as never,
    });
    seedResume(candidates, candidateId, 'Head of Platform', ['Перевела платформу на Kubernetes']);
    const text = async () => {
      const id = (await prepareResume()).json().data.versionId;
      return JSON.stringify(candidates.getResumeVersion(candidateId, id)?.snapshot.document.experience);
    };
    expect(await text()).toContain('moved to Kubernetes');
    expect((await call('GET', PATH)).json().data.lang).toBe('en');
    expect((await call('PUT', PATH, { action: 'lang', lang: 'ru' })).json().data.lang).toBe('ru');
    expect(await text()).toContain('Перевела платформу');
  });
});
