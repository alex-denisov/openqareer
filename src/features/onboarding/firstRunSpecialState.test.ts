import { describe, expect, it } from 'vitest';

import {
  connectorPresence,
  fileStaleLabel,
  linkedinStaleLabel,
  partialSourcesMessage,
  sessionGateState,
} from './firstRunSpecialState';

describe('first-run special states (B538)', () => {
  it('derives the session gate state from error and wait', () => {
    expect(sessionGateState({ waitIsLong: false })).toBe('skeleton');
    expect(sessionGateState({ waitIsLong: true })).toBe('stale-loading');
    expect(sessionGateState({ error: 'network_error', waitIsLong: true })).toBe('error');
  });

  it('notes a partial source set only when exactly one connector is live', () => {
    expect(partialSourcesMessage(null)).toBeNull();
    expect(partialSourcesMessage({ linkedin: false, hh: false })).toBeNull();
    expect(partialSourcesMessage({ linkedin: true, hh: true })).toBeNull();
    expect(partialSourcesMessage({ linkedin: true, hh: false })).toBe(
      'LinkedIn подключён, hh.ru нет: доступно после подключения hh.ru.',
    );
    expect(partialSourcesMessage({ linkedin: false, hh: true })).toBe(
      'hh.ru подключён, LinkedIn нет: доступно после подключения LinkedIn.',
    );
  });

  it('counts only connected platforms as present', () => {
    expect(
      connectorPresence([
        { platform: 'linkedin', status: 'connected' },
        { platform: 'hh', status: 'disconnected' },
      ]),
    ).toEqual({ linkedin: true, hh: false });
  });

  it('names the subject and the section being read', () => {
    expect(linkedinStaleLabel(null)).toBeNull();
    expect(linkedinStaleLabel({ readCount: 0, total: 0 })).toBeNull();
    expect(linkedinStaleLabel({ readCount: 1, total: 5 })).toBe('Читаем LinkedIn: раздел 2 из 5');
    expect(linkedinStaleLabel({ readCount: 5, total: 5 })).toBe('Читаем LinkedIn: раздел 5 из 5');
    expect(fileStaleLabel('cv.pdf')).toBe('Читаем файл: cv.pdf');
    expect(fileStaleLabel()).toBe('Читаем файл');
  });
});
