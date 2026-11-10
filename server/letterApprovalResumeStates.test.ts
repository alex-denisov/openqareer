import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoverLetterWriteInput, CoverLetterWriter } from './providers/coverLetterWriter';
import { letterPrompt } from './providers/coverLetterWriter';
import { seedResume, setup } from './testHelpers/letterApprovalHarness';

const ATTACHED_PHRASE = /резюме\s+(?:приложено|прилагаю)|resume\s+is\s+attached|cv\s+attached/iu;

afterEach(() => {
  vi.restoreAllMocks();
});

function writerReturning(body: string, inputs: CoverLetterWriteInput[] = []): CoverLetterWriter {
  return {
    writeCoverLetter: async (input) => {
      inputs.push(input);
      const rules = input.review?.(body) ?? [];
      return rules.length > 0 ? { failure: { stage: 'test', kind: 'unusable_response' } } : { body, stage: 'test' };
    },
  };
}

/** Факт профиля есть, а мест работы нет: модели есть о чём писать, резюме не существует. */
async function factsWithoutExperience(writer: CoverLetterWriter) {
  const context = await setup(undefined, { coverLetterWriter: writer });
  context.candidates.importResumeEvidence(context.candidateId, {
    sourceLabel: 'synthetic',
    entries: [{ memoryId: 'mem-course', domain: 'outcome', statement: 'Закончила курс по Kubernetes и собрала учебную платформу.' }],
  } as never);
  context.candidates.reviewMemories(context.candidateId, ['mem-course'], 'confirm');
  return context;
}

function failSnapshots(): void {
  vi.spyOn(SqliteCandidateStore.prototype, 'createResumeVersion').mockImplementation(() => {
    throw new Error('disk I/O error');
  });
}

function uploadGeneralResume(candidates: Awaited<ReturnType<typeof setup>>['candidates'], candidateId: string): string {
  return candidates.saveDocument(candidateId, {
    kind: 'resume',
    source: 'upload',
    fileName: 'cv.pdf',
    mimeType: 'application/pdf',
    contentBase64: Buffer.from('%PDF-1.4 synthetic').toString('base64'),
    parseStatus: 'not_applicable',
  }).document.id;
}

describe('B601 (08.11): Free прикладывает общее резюме без подгонки', () => {
  it('Free: снимок общего резюме без версии «под вакансию», повтор без дублей', async () => {
    const { candidates, candidateId, approve, pitch, versions, resumeDocuments } = await setup('Head of Platform', { billingEnforcement: true });
    expect((await pitch()).json().data).toMatchObject({ resumeAvailable: true, resumeKind: 'master' });
    const first = (await approve()).json().data;
    expect(first.resume).toMatchObject({ kind: 'master', versionId: null });
    const content = JSON.parse(Buffer.from(candidates.getDocument(candidateId, first.resume.documentId)!.contentBase64, 'base64').toString('utf8'));
    expect(content).toMatchObject({ kind: 'master', title: 'Общее резюме', sent: false });
    expect(content.snapshot.document.experience).toHaveLength(1);
    expect(versions()).toHaveLength(0);
    const second = (await approve()).json().data;
    expect(second.resume.documentId).toBe(first.resume.documentId);
    expect(resumeDocuments()).toHaveLength(1);
  });

  it('Basic и выше (тарифы выключены = платное поведение): резюме под вакансию', async () => {
    const { pitch } = await setup('Head of Platform');
    expect((await pitch()).json().data).toMatchObject({ resumeAvailable: true, resumeKind: 'targeted' });
  });
});

describe('B601 (08.11): опыта работы нет', () => {
  it('запрос модели не просит фразу о резюме, проверка письма не пропускает её', async () => {
    const inputs: CoverLetterWriteInput[] = [];
    const { pitch } = await factsWithoutExperience(writerReturning('Добрый день. Готов обсудить роль. Резюме приложено.', inputs));
    const response = await pitch();
    expect(inputs.at(-1)?.resumeAttached).toBe(false);
    expect(letterPrompt(inputs.at(-1)!)).not.toMatch(/резюме приложено|скажи, что резюме/iu);
    // Письмо с обещанием отклонено проверкой: молча обещать приложение нельзя.
    expect(response.statusCode).toBe(503);
  });

  it('письмо модели без упоминания резюме принимается и не содержит фраз о приложении', async () => {
    const { pitch } = await factsWithoutExperience(writerReturning('Добрый день. Готов обсудить роль платформы.'));
    const data = (await pitch()).json().data;
    expect(data).toMatchObject({ resumeAvailable: false, bodySource: 'model' });
    expect(data.emailPitch.body).not.toMatch(ATTACHED_PHRASE);
  });

  it('шаблоны кругов 1 и 2 без опыта не говорят, что резюме приложено', async () => {
    const { pitch } = await setup();
    const template = (await pitch()).json().data;
    expect(template.bodySource).toBe('template');
    for (const text of [template.emailPitch.body, template.linkedInNote, template.atsCoverLetter, template.contactMessage ?? '']) {
      expect(text).not.toMatch(ATTACHED_PHRASE);
    }
  });

  it('одобрение разрешено, резюме не привязано', async () => {
    const { candidates, candidateId, approve } = await setup();
    const data = (await approve({ resumeAvailable: false })).json().data;
    expect(data).toMatchObject({ status: 'approved', sent: false, resume: null });
    expect(candidates.getApplication(candidateId, data.applicationId)?.materials).toEqual({ coverLetter: true, resume: false });
  });

  it('признак черновика не совпал с резюме сейчас: письмо не одобряется, его готовят заново', async () => {
    const { candidates, candidateId, approve } = await setup();
    seedResume(candidates, candidateId, 'Head of Platform');
    const response = await approve({ resumeAvailable: false });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('letter_resume_changed');
    expect(candidates.listApplications(candidateId)).toHaveLength(0);
  });
});

describe('B601 (08.11): снимок резюме не создался', () => {
  it('гейт: письмо не одобряется, заявки и письма нет, общего резюме нет', async () => {
    const { candidates, candidateId, approve } = await setup('Head of Platform');
    failSnapshots();
    const response = await approve({ resumeAvailable: true });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({ code: 'resume_snapshot_failed', retryable: true });
    expect(response.json().error.details).toEqual({ generalResume: null });
    expect(candidates.getSnapshot(candidateId).documents).toHaveLength(0);
  });

  it('«Подготовить резюме» повторяет снимок: сбой — 503, после восстановления — готово', async () => {
    const { prepareResume } = await setup('Head of Platform');
    const spy = vi.spyOn(SqliteCandidateStore.prototype, 'createResumeVersion').mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });
    expect((await prepareResume()).statusCode).toBe(503);
    const ready = await prepareResume();
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data).toMatchObject({ ready: true, resumeKind: 'targeted' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('повтор не удался: предлагается готовое общее резюме, и с ним письмо одобряется', async () => {
    const { candidates, candidateId, approve } = await setup('Head of Platform');
    const generalId = uploadGeneralResume(candidates, candidateId);
    failSnapshots();
    const failed = await approve();
    expect(failed.json().error.details.generalResume).toEqual({ documentId: generalId, fileName: 'cv.pdf' });
    const approved = (await approve({ generalResumeId: generalId })).json().data;
    expect(approved.resume).toMatchObject({ kind: 'general', documentId: generalId, versionId: null });
    expect(candidates.getApplication(candidateId, approved.applicationId)?.materials.resume).toBe(true);
  });

  it('чужой или выдуманный документ вместо общего резюме не принимается: снова гейт', async () => {
    const { approve } = await setup('Head of Platform');
    failSnapshots();
    expect((await approve({ generalResumeId: 'document-not-mine' })).statusCode).toBe(503);
  });
});

describe('B631: резюме под вакансию открывается поверх письма', () => {
  it('«Подготовить резюме» отдаёт версию, которую одобрение привяжет к отклику', async () => {
    const { prepareResume, approve } = await setup('Head of Platform');
    const prepared = (await prepareResume()).json().data;
    expect(prepared.versionId).toEqual(expect.any(String));
    const approved = (await approve()).json().data;
    expect(approved.resume).toMatchObject({ kind: 'targeted', versionId: prepared.versionId });
  });

  it('Free: версии нет, письмо прикладывает общее резюме', async () => {
    const { prepareResume } = await setup('Head of Platform', { billingEnforcement: true });
    expect((await prepareResume()).json().data).toMatchObject({ resumeKind: 'master', versionId: null });
  });
});
