import { describe, expect, it } from 'vitest';
import { calculateVacancyFingerprint, normalizeTextForComparison } from './vacancyFingerprint';

describe('Vacancy Fingerprint & Normalization', () => {
  it('normalizes text by stripping punctuation, extra whitespace and lowercasing', () => {
    const raw = '  Senior Fullstack Engineer (React / Node.js)   ';
    const normalized = normalizeTextForComparison(raw);
    expect(normalized).toBe('senior fullstack engineer react node.js');
  });

  it('generates consistent SHA-256 fingerprint for identical vacancy data', () => {
    const vacancy1 = {
      title: 'Senior Frontend Developer',
      company: 'Acme Corp',
      description: 'We are looking for a React + TypeScript pro to build our web app.',
      location: 'Remote',
    };
    const vacancy2 = {
      title: '  senior frontend developer ',
      company: 'ACME CORP',
      description: 'We are looking for a React + TypeScript pro to build our web app.',
      location: 'remote',
    };
    const hash1 = calculateVacancyFingerprint(vacancy1);
    const hash2 = calculateVacancyFingerprint(vacancy2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
  });

  it('generates different fingerprints for distinct companies or titles', () => {
    const v1 = {
      title: 'Product Manager',
      company: 'Company A',
      description: 'Lead B2B products.',
    };
    const v2 = {
      title: 'Product Manager',
      company: 'Company B',
      description: 'Lead B2B products.',
    };
    expect(calculateVacancyFingerprint(v1)).not.toBe(calculateVacancyFingerprint(v2));
  });
});
