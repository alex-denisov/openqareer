import { describe, expect, it } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import { profileFailureText } from './profileFailureText';

describe('profileFailureText', () => {
  it('network failure on save is plain Russian and says the text stayed', () => {
    expect(profileFailureText(new TypeError('Failed to fetch'), 'save')).toBe(
      'Не сохранилось: нет связи с сервером. Текст остался в поле.',
    );
  });
  it('never prints raw server text for a 5xx', () => {
    const reason = new CoachApiError('blocked by walk', 'http_500', true);
    const text = profileFailureText(reason, 'save');
    expect(text).not.toContain('walk');
    expect(text).toContain('сервер временно не отвечает');
  });
  it('names the field that failed validation', () => {
    const reason = new CoachApiError('Invalid email', 'validation_failed', false, {
      'candidate.contact.phone': 'Invalid',
    });
    expect(profileFailureText(reason, 'save')).toBe(
      'Не сохранилось: проверьте поле «Телефон». Текст остался в поле.',
    );
  });
  it('validation without known fields stays generic', () => {
    const reason = new CoachApiError('x', 'validation_failed', false);
    expect(profileFailureText(reason, 'save')).toContain('проверьте заполненные поля');
  });
  it('load error is human and has no raw text', () => {
    const reason = new CoachApiError('walk 500', 'http_500', true);
    const text = profileFailureText(reason, 'load');
    expect(text).not.toContain('walk');
    expect(text).toContain('Не удалось загрузить профиль');
  });
});
