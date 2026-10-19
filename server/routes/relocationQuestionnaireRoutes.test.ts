import { describe, expect, it } from 'vitest';
import { RELOCATION_CONSENT_VERSION } from '../../shared/relocationQuestionnaire';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { candidateAuthorization, createApp, stores } from '../appTestHarness';

async function createConsentedCandidate() {
  const app = await createApp();
  const authorization = candidateAuthorization(app);
  const candidateStore = stores.at(-1)!;
  const candidate = candidateStore.authenticate(authorization.slice('Bearer '.length))!;
  candidateStore.relocationQuestionnaireRepo.grantConsent(
    candidate.id,
    RELOCATION_CONSENT_VERSION,
    '2026-10-11T10:00:00.000Z',
  );
  return { app, authorization, candidateStore, candidate };
}

async function putStep(
  app: Awaited<ReturnType<typeof createApp>>,
  authorization: string,
  step: string,
  revision: number,
  payload: Record<string, unknown>,
) {
  return await app.inject({
    method: 'PUT',
    url: `/api/v1/candidate/relocation-questionnaire/steps/${step}`,
    headers: { authorization, origin: 'http://localhost:3000', 'if-match': `"${revision}"` },
    payload,
  });
}

describe('relocation questionnaire API', () => {
  it('does not expose personal fields before consent and grants the approved consent text', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const read = await app.inject({
      url: '/api/v1/candidate/relocation-questionnaire',
      headers: { authorization },
    });
    const grant = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/consent',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { versionId: RELOCATION_CONSENT_VERSION },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json().data).toMatchObject({
      profile: null,
      consent: { granted: false, status: 'not_granted' },
      consentTextStatus: 'approved',
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().data.consent).toMatchObject({ granted: true });
  });

  it('requires candidate authentication before reading the questionnaire', async () => {
    const app = await createApp();
    const response = await app.inject({ url: '/api/v1/candidate/relocation-questionnaire' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('saves a candidate step under consent and rejects a stale If-Match revision', async () => {
    const app = await createApp();
    const candidateStore = stores.at(-1)!;
    const candidate = candidateStore.authenticate(
      candidateAuthorization(app).slice('Bearer '.length),
    )!;
    candidateStore.relocationQuestionnaireRepo.grantConsent(
      candidate.id,
      RELOCATION_CONSENT_VERSION,
      '2026-10-11T10:00:00.000Z',
    );

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/steps/citizenship_documents',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
        'if-match': '"0"',
      },
      payload: { citizenshipCountryCodes: ['RU'], documents: [] },
    });
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/steps/citizenship_documents',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
        'if-match': '"0"',
      },
      payload: { citizenshipCountryCodes: ['RU'], documents: [] },
    });

    expect(saved.statusCode, JSON.stringify(saved.json())).toBe(200);
    expect(saved.headers.etag).toBe('"1"');
    expect(saved.json().data.profile.citizenshipDocuments.citizenshipCountryCodes).toEqual(['RU']);
    expect(stale.statusCode).toBe(412);
    expect(stale.json().error.code).toBe('relocation_profile_revision_conflict');
    expect(stale.json().error.details).toEqual({ currentRevision: 1 });
    expect(stale.json().error.message).not.toContain('RU');
  });

  it('supports skip and resume progress, restart, and consent revocation with deletion', async () => {
    const app = await createApp();
    const candidateStore = stores.at(-1)!;
    const candidate = candidateStore.authenticate(
      candidateAuthorization(app).slice('Bearer '.length),
    )!;
    candidateStore.relocationQuestionnaireRepo.grantConsent(
      candidate.id,
      RELOCATION_CONSENT_VERSION,
      '2026-10-11T10:00:00.000Z',
    );
    const authorization = candidateAuthorization(app);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/steps/citizenship_documents',
      headers: { authorization, origin: 'http://localhost:3000', 'if-match': '"0"' },
      payload: { citizenshipCountryCodes: ['RU'], documents: [] },
    });
    const progress = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/progress',
      headers: { authorization, origin: 'http://localhost:3000', 'if-match': saved.headers.etag! },
      payload: { currentStep: 'family', skippedSteps: ['education'] },
    });
    const restarted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/relocation-questionnaire',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'if-match': progress.headers.etag!,
      },
    });
    const afterRestart = await app.inject({
      url: '/api/v1/candidate/relocation-questionnaire',
      headers: { authorization },
    });
    const revoked = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/relocation-questionnaire/consent',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    const afterRevoke = await app.inject({
      url: '/api/v1/candidate/relocation-questionnaire',
      headers: { authorization },
    });

    expect(progress.statusCode).toBe(200);
    expect(progress.json().data.profile).toMatchObject({
      currentStep: 'family',
      skippedSteps: ['education'],
    });
    expect(restarted.statusCode).toBe(204);
    expect(afterRestart.json().data).toMatchObject({
      profile: { revision: 0, citizenshipDocuments: { citizenshipCountryCodes: [] } },
      consent: { granted: true },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().data).toMatchObject({
      consent: { granted: false, status: 'revoked' },
      deleted: true,
    });
    expect(afterRevoke.json().data.profile).toBeNull();
  });

  it('rejects an invalid questionnaire step without persisting it', async () => {
    const app = await createApp();
    const candidateStore = stores.at(-1)!;
    const candidate = candidateStore.authenticate(
      candidateAuthorization(app).slice('Bearer '.length),
    )!;
    candidateStore.relocationQuestionnaireRepo.grantConsent(
      candidate.id,
      RELOCATION_CONSENT_VERSION,
      '2026-10-11T10:00:00.000Z',
    );
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/steps/citizenship_documents',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
        'if-match': '"0"',
      },
      payload: { citizenshipCountryCodes: ['RU'], documents: [], passportNumber: '1234567' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_relocation_step');
    expect(candidateStore.relocationQuestionnaireRepo.getProfile(candidate.id)).toBeNull();
  });

  it('imports only candidate-owned LinkedIn language facts as unconfirmed proposals', async () => {
    const app = await createApp();
    const candidateStore = stores.at(-1)!;
    const authorization = candidateAuthorization(app);
    const candidate = candidateStore.authenticate(authorization.slice('Bearer '.length))!;
    const memoryId = 'imp7777777777-language-1';
    candidateStore.commitResumeImport(candidate.id, {
      evidence: {
        sourceLabel: 'Импорт: linkedin',
        sourceDigest: 'a'.repeat(64),
        entries: [
          { memoryId, domain: 'skill', statement: 'English — full professional proficiency' },
        ],
      },
      draft: {
        ...EMPTY_RESUME_DRAFT,
        languages: [
          {
            id: 'language-1',
            evidenceMemoryId: memoryId,
            name: 'English',
            cefr: 'C1',
            sourceLabel: 'Full professional proficiency',
          },
        ],
      },
      sourceReceipt: {
        platform: 'linkedin',
        accessMode: 'native_session_snapshot',
        sourceUrl: 'https://www.linkedin.com/in/synthetic-candidate/',
        capturedAt: '2026-10-11T10:00:00.000Z',
        importDigest: 'b'.repeat(64),
      },
    });
    candidateStore.relocationQuestionnaireRepo.grantConsent(
      candidate.id,
      RELOCATION_CONSENT_VERSION,
      '2026-10-11T10:01:00.000Z',
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/languages/linkedin',
      headers: { authorization, origin: 'http://localhost:3000', 'if-match': '"0"' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      importedCount: 1,
      source: 'linkedin',
      profile: {
        languages: {
          languages: [
            { name: 'English', level: 'C1', source: 'linkedin', confirmation: 'proposed' },
          ],
        },
      },
    });
  });

  it('does not contact LinkedIn when no candidate import snapshot is available', async () => {
    const { app, authorization } = await createConsentedCandidate();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/relocation-questionnaire/languages/linkedin',
      headers: { authorization, origin: 'http://localhost:3000', 'if-match': '"0"' },
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('linkedin_languages_unavailable');
  });

  it('creates, edits, and deletes visa and residence-permit records', async () => {
    const { app, authorization } = await createConsentedCandidate();
    const documentCreated = await putStep(app, authorization, 'citizenship_documents', 0, {
      citizenshipCountryCodes: ['RU'],
      documents: [
        { id: 'work-permit-1', kind: 'work_permit', countryCode: 'DE', expiresAt: '2027-10-01' },
      ],
    });
    const documentEdited = await putStep(app, authorization, 'citizenship_documents', 1, {
      citizenshipCountryCodes: ['RU'],
      documents: [
        { id: 'work-permit-1', kind: 'work_permit', countryCode: 'DE', expiresAt: '2028-10-01' },
      ],
    });
    const documentDeleted = await putStep(app, authorization, 'citizenship_documents', 2, {
      citizenshipCountryCodes: ['RU'],
      documents: [],
    });
    expect(documentCreated.statusCode).toBe(200);
    expect(documentCreated.json().data.profile.citizenshipDocuments.documents[0].expiresAt).toBe(
      '2027-10-01',
    );
    expect(documentEdited.json().data.profile.citizenshipDocuments.documents[0].expiresAt).toBe(
      '2028-10-01',
    );
    expect(documentDeleted.json().data.profile.citizenshipDocuments.documents).toEqual([]);
  });

  it('creates, edits, and deletes education and certificate records', async () => {
    const { app, authorization } = await createConsentedCandidate();
    const educationCreated = await putStep(app, authorization, 'education', 0, {
      education: [
        {
          id: 'degree-1',
          level: 'bachelor',
          title: 'Компьютерные науки',
          countryCode: 'RU',
          recognitionStatus: 'not_started',
        },
      ],
      certificates: [
        {
          id: 'cert-1',
          title: 'Cloud certificate',
          countryCode: 'US',
          recognitionStatus: 'unknown',
        },
      ],
    });
    const educationEdited = await putStep(app, authorization, 'education', 1, {
      education: [
        {
          id: 'degree-1',
          level: 'master',
          title: 'Информационные системы',
          countryCode: 'RU',
          recognitionStatus: 'in_progress',
        },
      ],
      certificates: [],
    });
    const educationDeleted = await putStep(app, authorization, 'education', 2, {
      education: [],
      certificates: [],
    });

    expect(educationCreated.json().data.profile.education.certificates).toHaveLength(1);
    expect(educationEdited.json().data.profile.education.education[0].level).toBe('master');
    expect(educationDeleted.json().data.profile.education).toMatchObject({
      education: [],
      certificates: [],
    });
  });

  it('creates, edits, and deletes candidate-entered language rows', async () => {
    const { app, authorization } = await createConsentedCandidate();
    const languageCreated = await putStep(app, authorization, 'languages', 0, {
      languages: [
        {
          id: 'english',
          name: 'English',
          level: 'C1',
          confirmation: 'confirmed',
        },
      ],
    });
    const languageEdited = await putStep(app, authorization, 'languages', 1, {
      languages: [
        {
          id: 'english',
          name: 'English',
          level: 'C2',
          confirmation: 'confirmed',
        },
      ],
    });
    const languageDeleted = await putStep(app, authorization, 'languages', 2, { languages: [] });

    expect(languageCreated.json().data.profile.languages.languages[0].level).toBe('C1');
    expect(languageEdited.json().data.profile.languages.languages[0].level).toBe('C2');
    expect(languageDeleted.json().data.profile.languages.languages).toEqual([]);
  });

  it('returns missing-citizenship and expiring-document alerts from the saved private step', async () => {
    const { app, authorization } = await createConsentedCandidate();
    const today = new Date();
    const expiresAt = new Date(today.valueOf() + 7 * 86_400_000).toISOString().slice(0, 10);
    const saved = await putStep(app, authorization, 'citizenship_documents', 0, {
      citizenshipCountryCodes: [],
      documents: [{ id: 'visa-1', kind: 'work_visa', countryCode: 'DE', expiresAt }],
    });
    const response = await app.inject({
      url: '/api/v1/candidate/relocation-questionnaire',
      headers: { authorization },
    });

    expect(saved.statusCode).toBe(200);
    expect(response.json().data.alerts).toEqual([
      { kind: 'citizenship_missing' },
      { kind: 'document_expiring', documentId: 'visa-1', expiresAt },
    ]);
  });

  it('does not let a candidate forge LinkedIn provenance on a new language row', async () => {
    const { app, authorization } = await createConsentedCandidate();
    const response = await putStep(app, authorization, 'languages', 0, {
      languages: [
        {
          id: 'english',
          name: 'English',
          level: 'C1',
          source: 'linkedin',
          confirmation: 'confirmed',
        },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_relocation_step');
  });
});
