// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from '../../applications/applicationsApi';
import { createElement } from 'react';
import { throwApiError } from '../../coach/apiClient';
import { mount } from '../kit/testDom';
import { existingResponseId, openExistingFirst, useSentElsewhere } from './existingResponse';

const application = (stage: string) =>
  ({ id: 'r1', clusterId: 'v1', stage }) as unknown as ApplicationView;

describe('повторный отклик на ту же вакансию (B801)', () => {
  it('отправленный отклик открывается вместо нового письма', () => {
    expect(existingResponseId('v1', [application('applied')])).toBe('r1');
    expect(existingResponseId('v1', [application('interview')])).toBe('r1');
  });
  it('черновик, архив, другая вакансия и письмо самого отклика — как раньше', () => {
    expect(existingResponseId('v1', [application('saved')])).toBeNull();
    expect(existingResponseId('v1', [application('archived')])).toBeNull();
    expect(existingResponseId('v2', [application('applied')])).toBeNull();
    expect(existingResponseId('r1', [application('applied')])).toBeNull();
  });
  it('черновик-дубль раньше отправленного: открывается отправленный', () => {
    const draft = { ...application('saved'), id: 'r0' };
    expect(existingResponseId('v1', [draft, application('applied')])).toBe('r1');
  });
  it('журнал пути в записи истории остаётся', () => {
    const state = { journey: ['a', 'b'] };
    window.history.replaceState(state, '', '/app/responses/v1');
    const moved = vi.fn();
    window.addEventListener('popstate', moved, { once: true });
    void openExistingFirst('v1', [application('applied')], new AbortController().signal);
    expect(moved).toHaveBeenCalledOnce();
    expect(window.history.state).toEqual(state);
    expect(window.location.pathname).toContain('r1');
  });
  it('сервер узнал дубль по объявлению: 409 открывает отправленный отклик', async () => {
    window.history.replaceState({ journey: ['a'] }, '', '/app/responses/v2');
    mount(
      createElement(function Screen() {
        useSentElsewhere('v2');
        return null;
      }),
    );
    const error = { code: 'already_applied', message: 'Отклик уже отправлен.', details: { applicationId: 'r9' } };
    await throwApiError(new Response(JSON.stringify({ error }), { status: 409 })).catch(() => undefined);
    expect(window.location.pathname).toContain('r9');
    expect(window.history.state).toEqual({ journey: ['a'] });
  });
});
