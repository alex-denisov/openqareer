import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { renderUnifiedVacancyView } from './renderVacancyTemplate';

function sampleVacancy(overrides: Partial<UnifiedVacancy> = {}): UnifiedVacancy {
  return {
    id: 'ats-greenhouse:12345',
    fingerprint: 'ats-greenhouse:12345',
    title: 'Staff Software Engineer',
    company: 'Anthropic',
    location: 'San Francisco, CA',
    isRemote: true,
    employmentType: 'Full-time',
    experienceLevel: 'Staff',
    salary: {
      from: 200000,
      to: 280000,
      currency: 'USD',
    },
    description: 'Anthropic is building reliable, interpretable, and steerable AI systems.',
    requiredSkills: ['TypeScript', 'React', 'Node.js', 'Distributed Systems', 'PostgreSQL', 'AWS'],
    responsibilities: [
      'Design and implement high-throughput distributed systems',
      'Collaborate with research and product engineering teams',
      'Drive technical architecture and engineering excellence',
    ],
    qualifications: [
      '7+ years of experience in distributed systems',
      'Deep expertise in TypeScript/Node.js or systems languages',
      'Proven track record of delivering production scale systems',
    ],
    niceToHave: [
      'Experience with AI/ML infrastructure and model deployment',
      'Familiarity with Kubernetes and cloud-native workflows',
    ],
    aboutCompany: 'Anthropic is an AI safety and research company working to build steerable, trustworthy systems.',
    url: 'https://boards.greenhouse.io/anthropic/jobs/12345',
    provenance: {
      sourceType: 'json_api',
      sourceId: 'ats-greenhouse',
      sourceName: 'Greenhouse',
      sourceUrl: 'https://boards.greenhouse.io/anthropic/jobs/12345',
      observedAt: '2026-09-14T00:00:00.000Z',
    },
    publishedAt: '2026-09-12T00:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

describe('renderUnifiedVacancyView (Dynamic LinkedIn Template Engine)', () => {
  describe('Hero line and metadata formatting', () => {
    it('formats hero line with title, company, location, remote badge, employment type, level, and salary', () => {
      const vacancy = sampleVacancy();
      const output = renderUnifiedVacancyView(vacancy);

      // 1. Title heading
      expect(output).toContain('# Staff Software Engineer');

      // 2. Company line with badges
      expect(output).toContain('**Anthropic** · San Francisco, CA · `Remote` · `Full-time`');

      // 3. Experience level
      expect(output).toContain('💼 **Уровень роли:** `Staff`');

      // 4. Compensation range
      expect(output).toContain('💰 **Компенсация:** `$200,000 – $280,000`');

      // 5. Status line with publication and provenance
      expect(output).toContain('🕒 **Статус:**');
      expect(output).toContain('Greenhouse');
    });

    it('handles on-site role and missing optional location or salary cleanly', () => {
      const vacancy = sampleVacancy({
        isRemote: false,
        location: undefined,
        employmentType: undefined,
        experienceLevel: undefined,
        salary: undefined,
      });
      const output = renderUnifiedVacancyView(vacancy);

      expect(output).toContain('# Staff Software Engineer');
      expect(output).toContain('**Anthropic** · `On-site`');
      expect(output).not.toContain('💼 **Уровень роли:**');
      expect(output).not.toContain('💰 **Компенсация:**');
    });

    it('formats single-bound salary (from only / to only) with proper currency', () => {
      const fromEur = sampleVacancy({
        salary: { from: 150000, currency: 'EUR' },
      });
      const toUsd = sampleVacancy({
        salary: { to: 190000, currency: 'USD' },
      });
      const fromRub = sampleVacancy({
        salary: { from: 120000, currency: 'RUB' },
      });
      const toCad = sampleVacancy({
        salary: { to: 160000, currency: 'CAD' },
      });

      expect(renderUnifiedVacancyView(fromEur)).toContain('💰 **Компенсация:** `от €150,000`');
      expect(renderUnifiedVacancyView(toUsd)).toContain('💰 **Компенсация:** `до $190,000`');
      expect(renderUnifiedVacancyView(fromRub)).toContain('💰 **Компенсация:** `от 120,000 ₽`');
      expect(renderUnifiedVacancyView(toCad)).toContain('💰 **Компенсация:** `до 160,000 CAD`');
    });

    it('formats non-USD and symbol currency ranges accurately', () => {
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: 'USD' } })))
        .toContain('💰 **Компенсация:** `$100,000 – $150,000`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000 } })))
        .toContain('💰 **Компенсация:** `$100,000 – $150,000`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: '$' } })))
        .toContain('💰 **Компенсация:** `$100,000 – $150,000`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: 'EUR' } })))
        .toContain('💰 **Компенсация:** `€100,000 – €150,000`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: '€' } })))
        .toContain('💰 **Компенсация:** `€100,000 – €150,000`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: 'GBP' } })))
        .toContain('💰 **Компенсация:** `£100,000 – £150,000`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: '£' } })))
        .toContain('💰 **Компенсация:** `£100,000 – £150,000`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: 'RUB' } })))
        .toContain('💰 **Компенсация:** `100,000 – 150,000 ₽`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: '₽' } })))
        .toContain('💰 **Компенсация:** `100,000 – 150,000 ₽`');
      expect(renderUnifiedVacancyView(sampleVacancy({ salary: { from: 100000, to: 150000, currency: 'CAD' } })))
        .toContain('💰 **Компенсация:** `100,000 – 150,000 CAD`');
    });
  });

  describe('Top Skills & Match section', () => {
    it('renders Top Skills & Match with formatted badges', () => {
      const vacancy = sampleVacancy();
      const output = renderUnifiedVacancyView(vacancy);

      expect(output).toContain('### Top Skills & Match');
      expect(output).toContain('🎯 **Ключевой стек роли:**');
      expect(output).toContain('`[TypeScript]` `[React]` `[Node.js]` `[Distributed Systems]` `[PostgreSQL]` `[AWS]`');
    });

    it('omits Top Skills & Match section when skills array is empty', () => {
      const vacancy = sampleVacancy({ requiredSkills: [] });
      const output = renderUnifiedVacancyView(vacancy);

      expect(output).not.toContain('### Top Skills & Match');
      expect(output).not.toContain('🎯 **Ключевой стек роли:**');
    });
  });

  describe('Structured sections (About Role, What You Do, Qualifications, About Company)', () => {
    it('structures sections from pre-parsed vacancy arrays', () => {
      const vacancy = sampleVacancy();
      const output = renderUnifiedVacancyView(vacancy);

      expect(output).toContain('### About the Role');
      expect(output).toContain('Anthropic is building reliable, interpretable, and steerable AI systems.');

      expect(output).toContain("### What You'll Do");
      expect(output).toContain('- Design and implement high-throughput distributed systems');
      expect(output).toContain('- Collaborate with research and product engineering teams');

      expect(output).toContain('### Basic Qualifications');
      expect(output).toContain('- 7+ years of experience in distributed systems');

      expect(output).toContain('### Preferred Qualifications');
      expect(output).toContain('- Experience with AI/ML infrastructure and model deployment');

      expect(output).toContain('### About Anthropic');
      expect(output).toContain('Anthropic is an AI safety and research company working to build steerable, trustworthy systems.');
    });

    it('extracts structured sections from raw markdown description when fields are not pre-split', () => {
      const rawDescription = `
We are looking for a Senior Platform Engineer to build scalable developer tooling.

## Responsibilities
- Architect high-throughput API gateways
- Optimize CI/CD delivery pipelines
- Partner with product squads

## Requirements
- 5+ years of software development experience
- Solid understanding of Linux networking and Docker
- Deep familiarity with TypeScript

## Nice to Have
- Hands-on experience with Rust
- Background in Kubernetes operators

## About Acme Corp
Acme Corp provides automated cloud infrastructure for modern engineering teams.
      `.trim();

      const vacancy = sampleVacancy({
        description: rawDescription,
        responsibilities: undefined,
        qualifications: undefined,
        niceToHave: undefined,
        aboutCompany: undefined,
      });

      const output = renderUnifiedVacancyView(vacancy);

      expect(output).toContain('### About the Role');
      expect(output).toContain('We are looking for a Senior Platform Engineer to build scalable developer tooling.');

      expect(output).toContain("### What You'll Do");
      expect(output).toContain('- Architect high-throughput API gateways');
      expect(output).toContain('- Optimize CI/CD delivery pipelines');

      expect(output).toContain('### Basic Qualifications');
      expect(output).toContain('- 5+ years of software development experience');
      expect(output).toContain('- Deep familiarity with TypeScript');

      expect(output).toContain('### Preferred Qualifications');
      expect(output).toContain('- Hands-on experience with Rust');
      expect(output).toContain('- Background in Kubernetes operators');

      expect(output).toContain('### About Anthropic');
      expect(output).toContain('Acme Corp provides automated cloud infrastructure for modern engineering teams.');
    });
  });

  describe('EEO boilerplate stripping', () => {
    it('strips generic equal opportunity employer disclaimers from raw descriptions', () => {
      const descriptionWithEeo = `
Join our team building the next generation of cloud storage.

## Responsibilities
- Design and ship distributed storage nodes
- Improve cluster replication latency

## Requirements
- 4+ years experience in systems programming

Equal Opportunity Employer:
We are an Equal Opportunity Employer and do not discriminate against any employee or applicant for employment because of race, color, sex, age, national origin, religion, sexual orientation, gender identity, status as a veteran, and basis of disability or any other federal, state or local protected class. We are committed to providing reasonable accommodations for individuals with disabilities.
      `.trim();

      const vacancy = sampleVacancy({
        description: descriptionWithEeo,
        responsibilities: undefined,
        qualifications: undefined,
        niceToHave: undefined,
        aboutCompany: undefined,
      });

      const output = renderUnifiedVacancyView(vacancy);

      expect(output).not.toContain('Equal Opportunity Employer');
      expect(output).not.toContain('discriminate against any employee');
      expect(output).not.toContain('race, color, sex, age');
      expect(output).not.toContain('reasonable accommodations');
      expect(output).toContain('Join our team building the next generation of cloud storage.');
      expect(output).toContain('- Design and ship distributed storage nodes');
    });

    it('strips inline EEO paragraphs in structured description', () => {
      const descriptionWithInlineEeo = `
Join our mission to revolutionize search.

Acme is proud to be an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, color, religion, gender, gender identity or expression, sexual orientation, national origin, genetics, disability, age, or veteran status.
      `.trim();

      const vacancy = sampleVacancy({
        description: descriptionWithInlineEeo,
      });

      const output = renderUnifiedVacancyView(vacancy);

      expect(output).toContain('Join our mission to revolutionize search.');
      expect(output).not.toContain('equal opportunity employer');
      expect(output).not.toContain('without regard to race');
    });
  });

  describe('Template versions and switching', () => {
    it('defaults to linkedin-v1 when templateVersion is omitted', () => {
      const vacancy = sampleVacancy();
      const outputDefault = renderUnifiedVacancyView(vacancy);
      const outputExplicit = renderUnifiedVacancyView(vacancy, 'linkedin-v1');

      expect(outputDefault).toBe(outputExplicit);
    });

    it('throws descriptive error on unsupported template version', () => {
      const vacancy = sampleVacancy();
      expect(() => renderUnifiedVacancyView(vacancy, 'unknown-v99')).toThrow(
        /Unsupported vacancy template version: unknown-v99/i,
      );
    });
  });
});
