import { describe, expect, it } from 'vitest';
import type { RecruiterContact } from '../../shared/recruiterContact';
import { toCandidateContact } from './candidateRecruiterContact';

const CONTACT: RecruiterContact = {
  id: 'c-1',
  vacancyId: 'vac-1',
  fullName: 'Анна Семёнова',
  roleTitle: 'Talent Partner',
  email: 'anna@example.com',
  emailStatus: 'verified',
  telegram: null,
  whatsapp: null,
  phone: null,
  linkedinUrl: null,
  githubUrl: null,
  twitterUrl: null,
  sourceType: 'linkedin_pool',
  confidence: 0.8,
  sourceReceipt: {
    receiptId: 'r-1',
    source: 'linkedin_pool',
    method: 'company_recruiter_discovery',
    observedAt: '2026-09-27T00:00:00.000Z',
    confidence: 0.8,
    sourceUrl: 'https://www.linkedin.com/in/anna',
  },
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
} as RecruiterContact;

describe('toCandidateContact (C59)', () => {
  it('не отдаёт кандидату внутреннюю квитанцию источника', () => {
    const shown = toCandidateContact(CONTACT);
    expect(shown).not.toHaveProperty('sourceReceipt');
    expect(JSON.stringify(shown)).not.toContain('company_recruiter_discovery');
    expect(shown.fullName).toBe('Анна Семёнова');
    expect(shown.email).toBe('anna@example.com');
  });
});
