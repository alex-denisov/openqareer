import { describe, expect, it } from 'vitest';
import {
  excludedEvidenceIdsForWorkplaces,
  letterBodyForCircle,
  recipientForConnectionPath,
} from './vacancyLetterModel';

describe('vacancy letter model', () => {
  it('uses the selected contact message for circles one and two and the email body for cold outreach', () => {
    const pitch = {
      contactMessage: 'Мария, добрый день',
      emailPitch: { subject: 'Отклик', body: 'Здравствуйте, команда' },
    };

    expect(letterBodyForCircle(1, pitch)).toBe('Мария, добрый день');
    expect(letterBodyForCircle(2, pitch)).toBe('Мария, добрый день');
    expect(letterBodyForCircle(3, pitch)).toBe('Здравствуйте, команда');
  });

  it('maps a path recipient to the pitch generator input without inventing contact data', () => {
    expect(
      recipientForConnectionPath({
        recipient: { id: 'person-1', fullName: 'Мария Орлова', roleTitle: 'Рекрутер', companyName: null },
      }),
    ).toEqual({ name: 'Мария Орлова', role: 'Рекрутер' });
    expect(
      recipientForConnectionPath({
        recipient: { id: 'person-2', fullName: 'Сергей', roleTitle: null, companyName: null },
      }),
    ).toEqual({ name: 'Сергей' });
  });

  it('excludes every evidence item belonging to an unchecked workplace', () => {
    expect(
      excludedEvidenceIdsForWorkplaces(
        [
          { id: 'work-1', evidenceIds: ['memory-1', 'memory-2'] },
          { id: 'work-2', evidenceIds: ['memory-2', 'memory-3'] },
        ],
        ['work-1'],
      ),
    ).toEqual(['memory-3']);
  });
});
