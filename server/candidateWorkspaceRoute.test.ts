import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp } from './appTestHarness';

const workspace = {
  careerGoal: 'find-job' as const,
  resumeText:
    'Синтетический кандидат: руководила продуктом в финтехе, отвечала за активацию и монетизацию.',
  resumeSource: 'text' as const,
  targetDirection: 'Senior Product Manager',
  market: 'international' as const,
  currentSituation: 'Ищу работу за рубежом и рассматриваю релокацию.',
  constraints: 'Только удалённо или с релокацией.',
  urgency: 'active' as const,
};

/**
 * The wizard's own answers lived only in `localStorage`, so signing out erased
 * the candidate's career context and signing back in restarted the diagnostic
 * with every section locked — while the server still held their resume and
 * facts (INC-024).
 */
describe('candidate workspace persistence', () => {
  it('returns nothing for a candidate who has not completed the wizard', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/workspace',
      headers: { authorization: candidateAuthorization(app) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
  });

  it('stores the wizard answers and returns them on the next reading', async () => {
    const app = await createApp();

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/workspace',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: { workspace },
    });
    expect(saved.statusCode).toBe(200);

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/workspace',
      headers: { authorization: candidateAuthorization(app) },
    });

    expect(read.json().data).toMatchObject({
      targetDirection: 'Senior Product Manager',
      market: 'international',
      urgency: 'active',
      currentSituation: 'Ищу работу за рубежом и рассматриваю релокацию.',
    });
  });

  it('replaces the previous answers instead of accumulating them', async () => {
    const app = await createApp();
    const headers = {
      authorization: candidateAuthorization(app),
      origin: 'http://localhost:3000',
    };

    await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/workspace',
      headers,
      payload: { workspace },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/workspace',
      headers,
      payload: { workspace: { ...workspace, targetDirection: 'Head of Product' } },
    });

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/workspace',
      headers: { authorization: candidateAuthorization(app) },
    });
    expect(read.json().data.targetDirection).toBe('Head of Product');
  });

  it('refuses an unauthenticated reading', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/workspace',
    });

    expect(response.statusCode).toBe(401);
  });
});
