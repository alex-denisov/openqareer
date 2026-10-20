import { describe, expect, it } from 'vitest';
import { resolveApplicationContacts } from './applicationContact';

const recruiter = (vacancyId: string, fullName: string, confidence: number) => ({
  vacancyId,
  fullName,
  confidence,
});

describe('resolveApplicationContacts (B542)', () => {
  it('takes the most confident vacancy recruiter, and the candidate own contact wins', () => {
    const contacts = resolveApplicationContacts(
      [
        { id: 'app-1', clusterId: 'v-1' },
        { id: 'app-2', clusterId: 'v-2' },
        { id: 'app-3', clusterId: null },
      ],
      new Map([['app-2', 'Иван Петров']]),
      [
        recruiter('v-1', 'Ольга Белая', 0.4),
        recruiter('v-1', 'Мария Орлова', 0.9),
        recruiter('v-2', 'Анна Смирнова', 0.9),
        recruiter('v-1', '  ', 1),
      ],
    );
    expect(contacts.get('app-1')).toEqual({ name: 'Мария Орлова', source: 'vacancy' });
    expect(contacts.get('app-2')).toEqual({ name: 'Иван Петров', source: 'candidate' });
    expect(contacts.has('app-3')).toBe(false);
  });
});
