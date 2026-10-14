import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import * as apiClient from '../coach/apiClient';
import {
  getRelocationQuestionnaire,
  putRelocationQuestionnaireStep,
  restartRelocationQuestionnaire,
} from './relocationApi';

afterEach(() => vi.restoreAllMocks());

describe('relocation questionnaire API client', () => {
  it('reads the server consent gate without assuming the questionnaire is active', async () => {
    const consent = {
      status: 'not_granted' as const,
      granted: false,
      versionId: null,
      grantedAt: null,
      revokedAt: null,
    };
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            profile: null,
            consent,
            consentTextStatus: 'pending_dpo_review',
            alerts: [],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(getRelocationQuestionnaire()).resolves.toMatchObject({
      profile: null,
      consent,
      consentTextStatus: 'pending_dpo_review',
    });
    expect(apiClient.apiFetch).toHaveBeenCalledWith('/api/v1/candidate/relocation-questionnaire');
  });

  it('saves a validated step with the profile revision in If-Match', async () => {
    const profile = emptyRelocationQuestionnaire();
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { profile: { ...profile, revision: 1 }, alerts: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const step = { citizenshipCountryCodes: ['RU'], documents: [] };

    await putRelocationQuestionnaireStep('citizenship_documents', step, profile.revision);

    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/relocation-questionnaire/steps/citizenship_documents',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
        body: JSON.stringify(step),
      }),
    );
  });

  it('accepts the server 204 response when restarting the questionnaire', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(restartRelocationQuestionnaire()).resolves.toBeUndefined();

    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/relocation-questionnaire',
      { method: 'DELETE' },
    );
  });
});
