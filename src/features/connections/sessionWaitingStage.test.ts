import { describe, expect, it } from 'vitest';
import {
  UNRECOGNISED_PATIENCE_POLLS,
  sessionUnreadableNotice,
  sessionWaitingStage,
} from './sessionWaitingStage';

const page = (patch: Partial<Parameters<typeof sessionWaitingStage>[0]> = {}) => ({
  ready: true,
  url: 'https://hh.ru/',
  signedInApplicant: false,
  login: false,
  otp: false,
  captcha: false,
  ...patch,
});

describe('sessionWaitingStage', () => {
  it('puts a platform challenge above readiness', () => {
    expect(sessionWaitingStage(page({ captcha: true, ready: false }))).toBe('captcha');
    expect(sessionWaitingStage(page({ otp: true, login: true }))).toBe('otp');
    expect(sessionWaitingStage(page({ login: true }))).toBe('login');
  });

  it('separates a page that has not loaded from one it does not recognise', () => {
    expect(sessionWaitingStage(page({ ready: false }))).toBe('loading');
    expect(sessionWaitingStage(page())).toBe('unrecognised');
  });
});

describe('sessionUnreadableNotice', () => {
  it('waits through a page that cannot be read yet', () => {
    expect(sessionUnreadableNotice('Страница не загрузилась', 1, 'Загружаем…')).toEqual({
      text: 'Загружаем…',
      stuck: false,
    });
  });

  it('stops waiting and says what went wrong once patience runs out', () => {
    expect(
      sessionUnreadableNotice(
        'Страница не загрузилась',
        UNRECOGNISED_PATIENCE_POLLS,
        'Загружаем…',
      ),
    ).toEqual({ text: 'Страница не загрузилась', stuck: true });
  });
});
