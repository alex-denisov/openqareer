import { describe, expect, it } from 'vitest';
import {
  excludedEvidenceIdsForWorkplaces,
  letterBodyForCircle,
  recipientForConnectionPath,
} from './vacancyLetterModel';
import type { ConnectionCirclePath } from './vacancyLetterApi';

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
        circle: 1,
        path: [],
        recipient: {
          id: 'person-1',
          fullName: 'Мария Орлова',
          roleTitle: 'Рекрутер',
          companyName: null,
        },
      }),
    ).toEqual({ name: 'Мария Орлова', role: 'Рекрутер' });
    expect(
      recipientForConnectionPath({
        circle: 1,
        path: [],
        recipient: { id: 'person-2', fullName: 'Сергей', roleTitle: null, companyName: null },
      }),
    ).toEqual({ name: 'Сергей' });
  });

  it('addresses a circle-two introduction request to the candidate contact, not the final recipient', () => {
    const path: ConnectionCirclePath = {
      id: 'intro-1',
      circle: 2,
      path: [
        { id: 'candidate', fullName: 'Андрей', roleTitle: null, companyName: null },
        {
          id: 'contact',
          fullName: 'Игорь Н.',
          roleTitle: 'Продакт-менеджер',
          companyName: 'Вектор Банк',
        },
        {
          id: 'recruiter',
          fullName: 'Сергей В.',
          roleTitle: 'Руководитель платежей',
          companyName: 'Вектор Банк',
        },
      ],
      recipient: {
        id: 'recruiter',
        fullName: 'Сергей В.',
        roleTitle: 'Руководитель платежей',
        companyName: 'Вектор Банк',
      },
      evidence: ['Игорь знает Сергея'],
      strength: 'strong',
      source: 'manual',
      nextStep: 'ask_for_introduction',
    };

    expect(recipientForConnectionPath(path)).toEqual({
      name: 'Игорь Н.',
      role: 'Продакт-менеджер',
    });
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
