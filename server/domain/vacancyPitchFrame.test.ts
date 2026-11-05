import { describe, expect, it } from 'vitest';
import { frameModelLetter } from './vacancyPitchService';

describe('frameModelLetter', () => {
  it('signs a Russian letter as the candidate wrote the name', () => {
    expect(frameModelLetter('Текст.', 'ru', 'Bjak', 'Алексей Иванов')).toBe('Уважаемая команда Bjak!\n\nТекст.\n\nС уважением,\nАлексей Иванов');
  });

  it('signs an English letter in Latin', () => {
    expect(frameModelLetter('Text.', 'en', 'Bjak', 'Алексей Иванов')).toMatch(/^Dear Bjak Team,\n\nText\.\n\nBest regards,\nAlek\w+ Ivanov$/u);
  });

  it('leaves the name out when the profile has none', () => {
    expect(frameModelLetter('Text.', 'en', undefined, undefined)).toBe('Dear Hiring Team,\n\nText.\n\nBest regards,');
  });
});
