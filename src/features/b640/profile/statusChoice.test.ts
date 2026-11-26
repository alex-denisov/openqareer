import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateStatusState } from '../../../../shared/candidateStatus';
import * as apiClient from '../../coach/apiClient';
import {
  changeStatus,
  choiceBody,
  getStatus,
  initialChoice,
  previewStatus,
  sameChoice,
} from './statusChoice';

const reply = (data: unknown): Response => new Response(JSON.stringify({ data }), { status: 200 });
const json = { 'Content-Type': 'application/json' };

const STATE = {
  current: {
    status: 'job_search',
    label: 'Ищу работу',
    title: 'Ищу работу',
    targetProfession: null,
    since: null,
    chosen: false,
  },
  statuses: [],
  history: [],
  revert: null,
} as CandidateStatusState;

describe('b640 profile: клиент выбора статуса', () => {
  afterEach(() => vi.restoreAllMocks());

  it('читает статус', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(reply(STATE));
    const controller = new AbortController();
    await expect(getStatus(controller.signal)).resolves.toEqual(STATE);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/status', { signal: controller.signal });
  });

  it('просит «Что изменится» для выбранного статуса', async () => {
    const preview = { from: 'job_search', to: 'working', title: 'Работаю', unchanged: false };
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(reply({ preview }));
    const controller = new AbortController();
    await expect(
      previewStatus({ status: 'working', targetProfession: '' }, controller.signal),
    ).resolves.toEqual(preview);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/status/preview', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ status: 'working' }),
      signal: controller.signal,
    });
  });

  it('меняет статус с отметками кандидата', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(reply(STATE));
    await changeStatus(
      { status: 'changing_profession', targetProfession: '  продакт-менеджер ' },
      { pauseAutoApply: true },
    );
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/status', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({
        status: 'changing_profession',
        targetProfession: 'продакт-менеджер',
        options: { pauseAutoApply: true },
      }),
    });
  });
});

describe('b640 profile: выбор статуса', () => {
  it('профессию шлёт только при «Меняю профессию», без пробелов и не длиннее 80 знаков', () => {
    expect(choiceBody({ status: 'working', targetProfession: 'x' })).toEqual({ status: 'working' });
    expect(choiceBody({ status: 'changing_profession', targetProfession: '   ' })).toEqual({
      status: 'changing_profession',
    });
    const long = 'я'.repeat(200);
    expect(
      choiceBody({ status: 'changing_profession', targetProfession: long }).targetProfession,
    ).toHaveLength(80);
  });

  it('по умолчанию выбран нынешний статус', () => {
    expect(initialChoice('', STATE)).toEqual({ status: 'job_search', targetProfession: '' });
    const changing = {
      ...STATE,
      current: { ...STATE.current, status: 'changing_profession', targetProfession: 'аналитик' },
    } as CandidateStatusState;
    expect(initialChoice('', changing)).toEqual({
      status: 'changing_profession',
      targetProfession: 'аналитик',
    });
  });

  it('берёт предложение из адреса, если статус из списка', () => {
    expect(initialChoice('?status=working', STATE)).toEqual({
      status: 'working',
      targetProfession: '',
    });
    expect(
      initialChoice(
        '?status=changing_profession&profession=%D0%A3%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5+%D0%BF%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82%D0%BE%D0%BC',
        STATE,
      ),
    ).toEqual({ status: 'changing_profession', targetProfession: 'Управление продуктом' });
  });

  it('чужие значения из адреса не принимает', () => {
    expect(initialChoice('?status=admin&profession=x', STATE).status).toBe('job_search');
    expect(initialChoice('?status=__proto__', STATE).status).toBe('job_search');
    // Профессия из адреса без «Меняю профессию» не нужна.
    expect(initialChoice('?status=working&profession=x', STATE).targetProfession).toBe('');
    const noisy = initialChoice(
      `?status=changing_profession&profession=${'a'.repeat(300)}%00%0A`,
      STATE,
    );
    expect(noisy.targetProfession).toHaveLength(80);
  });

  it('тот же статус с той же профессией — менять нечего', () => {
    expect(sameChoice({ status: 'job_search', targetProfession: '' }, STATE)).toBe(true);
    expect(sameChoice({ status: 'working', targetProfession: '' }, STATE)).toBe(false);
    const changing = {
      ...STATE,
      current: { ...STATE.current, status: 'changing_profession', targetProfession: 'аналитик' },
    } as CandidateStatusState;
    expect(
      sameChoice({ status: 'changing_profession', targetProfession: ' аналитик ' }, changing),
    ).toBe(true);
    expect(sameChoice({ status: 'changing_profession', targetProfession: 'юрист' }, changing)).toBe(
      false,
    );
  });
});
