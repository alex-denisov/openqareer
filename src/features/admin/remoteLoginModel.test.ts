import { describe, expect, it } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import {
  frameToPagePoint,
  isRemoteLoginGone,
  remoteLoginErrorText,
  remoteLoginStatusText,
} from './remoteLoginModel';

const PAGE = { width: 1440, height: 900 };

describe('frameToPagePoint', () => {
  it('scales a click on a shrunken image to page coordinates', () => {
    const box = { left: 100, top: 50, width: 720, height: 450 };
    expect(frameToPagePoint({ clientX: 460, clientY: 275 }, box, PAGE)).toEqual({ x: 720, y: 450 });
    expect(frameToPagePoint({ clientX: 100, clientY: 50 }, box, PAGE)).toEqual({ x: 0, y: 0 });
  });

  it('clamps clicks on the border and rejects an unmeasured image', () => {
    const box = { left: 0, top: 0, width: 360, height: 225 };
    expect(frameToPagePoint({ clientX: 360, clientY: 225 }, box, PAGE)).toEqual({ x: 1439, y: 899 });
    expect(frameToPagePoint({ clientX: -5, clientY: -5 }, box, PAGE)).toEqual({ x: 0, y: 0 });
    expect(frameToPagePoint({ clientX: 1, clientY: 1 }, { ...box, width: 0 }, PAGE)).toBeNull();
  });
});

describe('remote login copy', () => {
  it('names every state in words', () => {
    expect(remoteLoginStatusText({ state: 'login', reason: null })).toBe('Страница входа LinkedIn');
    expect(remoteLoginStatusText({ state: 'checkpoint', reason: null })).toContain('пройдите её здесь');
    expect(remoteLoginStatusText({ state: 'signed_in', reason: null })).toBe(
      'Вход выполнен, сессия сохранена на сервере',
    );
    expect(remoteLoginStatusText({ state: 'closed', reason: 'idle' })).toBe(
      'Закрыто после 10 минут простоя',
    );
    expect(remoteLoginStatusText({ state: 'closed', reason: 'persist_failed' })).toContain('не удалось сохранить');
  });

  it('maps API codes to text and never leaks a generic success', () => {
    const busy = new CoachApiError('x', 'linkedin_profile_busy', false);
    expect(remoteLoginErrorText(busy)).toContain('занят');
    expect(remoteLoginErrorText(new CoachApiError('Своё сообщение', 'other', false))).toBe('Своё сообщение');
    expect(remoteLoginErrorText(new Error('boom'))).toContain('Не удалось связаться');
    expect(isRemoteLoginGone(new CoachApiError('x', 'remote_login_not_found', false))).toBe(true);
    expect(isRemoteLoginGone(busy)).toBe(false);
  });
});
