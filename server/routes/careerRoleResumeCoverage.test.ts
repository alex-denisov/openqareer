import { describe, expect, it } from 'vitest';
import type { ProposedRole } from '../../shared/roleProposals';
import type { ResumeDocument } from '../domain/resumeStudioTypes';
import { withResumeCoverage } from './careerRoleResumeCoverage';

const document = {
  contact: { links: [] },
  about: 'Руководил инженерными командами, строил DevOps-практики.',
  experience: [
    {
      title: { value: 'VP of Engineering' },
      employer: { value: 'Acme' },
      location: { value: 'Москва' },
      bullets: [{ value: 'Управление командой из 120 инженеров' }],
    },
  ],
  skills: [{ name: 'Cross-functional Team Leadership' }, { name: 'Amazon Web Services (AWS)' }],
  education: [],
  languages: [],
  projects: [],
} as unknown as ResumeDocument;

const observed = (
  repeatedRequirements: readonly string[],
  matchedRequirementNames: readonly string[] = [],
) =>
  ({
    id: 'role',
    title: 'VP of Engineering / Technology',
    origin: 'candidate',
    reason: null,
    evidenceRefs: [],
    family: 'other',
    aliases: [],
    confirmation: {
      state: 'observed',
      sampleSize: 20,
      observedFrom: '',
      observedTo: '',
      sources: [],
      repeatedRequirements,
      matchedRequirements: matchedRequirementNames.length,
      matchedRequirementNames,
    },
  }) as unknown as ProposedRole;

const names = (role: ProposedRole) =>
  role.confirmation.state === 'observed' ? role.confirmation.matchedRequirementNames : undefined;

describe('withResumeCoverage', () => {
  it('counts what ATS finds in the about section and the experience, not only skills', () => {
    const [role] = withResumeCoverage(
      [observed(['Управление командой', 'DevOps', 'Kubernetes'])],
      document,
    );
    expect(names(role)).toEqual(['Управление командой', 'DevOps']);
  });

  it('counts an abbreviation written in brackets', () => {
    const [role] = withResumeCoverage([observed(['AWS'])], document);
    expect(names(role)).toEqual(['AWS']);
  });

  it('keeps a requirement the candidate confirmed outside the resume', () => {
    const [role] = withResumeCoverage([observed(['Kafka'], ['Kafka'])], document);
    expect(names(role)).toEqual(['Kafka']);
  });

  it('leaves a role without observed vacancies as it is', () => {
    const role = { ...observed([]), confirmation: { state: 'too-few', sampleSize: 2 } };
    expect(withResumeCoverage([role as unknown as ProposedRole], document)).toEqual([role]);
  });
});
