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
