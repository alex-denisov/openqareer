import { describe, expect, it } from 'vitest';
import { buildOnboardingWorkspaceInput } from './onboardingWorkspaceInput';
import type { ParsedResume } from '../workspace/resumeParser';

function parsedResume(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    contact: { links: [] },
    experience: [],
    skills: [],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
    rawText: 'raw',
    ...overrides,
  };
}

describe('buildOnboardingWorkspaceInput', () => {
  it('carries the ingested document straight through, unmutated', () => {
    const parsed = parsedResume({ targetRole: 'VP of Technology Operations' });
    const input = buildOnboardingWorkspaceInput({
      sourceChoice: 'pdf',
      ingested: {
        parsed,
        draft: { experience: [] } as never,
        text: 'a'.repeat(90),
        source: 'pdf',
        imported: true,
        file: { name: 'cv.pdf', pages: 2 },
      },
      talk: { tasks: '', change: '', successMeasure: '' },
      selectedRoleTitle: 'VP of Technology Operations',
      regions: ['mena'],
      format: 'Полная занятость',
      reviewOverrides: {},
      linkedinUrl: '',
      hhUrl: '',
    });
    expect(input.resumeSource).toBe('pdf');
    expect(input.resumeText).toHaveLength(90);
    expect(input.targetDirection).toBe('VP of Technology Operations');
    expect(input.regions).toEqual(['mena']);
    expect(input.resumeFileName).toBe('cv.pdf');
    expect(input.careerGoal).toBeUndefined();
    // the source object is never mutated by this builder
    expect(parsed.targetRole).toBe('VP of Technology Operations');
  });

  it('falls back to the role chosen on the roles step when the document named none', () => {
    const input = buildOnboardingWorkspaceInput({
      sourceChoice: 'pdf',
      ingested: {
        parsed: parsedResume(),
        draft: { experience: [] } as never,
        text: 'a'.repeat(90),
        source: 'pdf',
        imported: true,
      },
      talk: { tasks: '', change: '', successMeasure: '' },
      selectedRoleTitle: 'Head of IT Operations',
      regions: [],
      format: 'Полная занятость',
      reviewOverrides: {},
      linkedinUrl: '',
      hhUrl: '',
    });
    expect(input.targetDirection).toBe('Head of IT Operations');
  });

  it('folds the talk-branch answers into the current-situation text without a document', () => {
    const input = buildOnboardingWorkspaceInput({
      sourceChoice: 'none',
      ingested: undefined,
      talk: {
        tasks: 'Вёл переговоры с 12 поставщиками',
        change: 'Меньше операционки',
        successMeasure: 'Команда выросла вдвое',
      },
      selectedRoleTitle: undefined,
      regions: [],
      format: 'Контракт / interim',
      reviewOverrides: {},
      linkedinUrl: '',
      hhUrl: '',
    });
    expect(input.currentSituation).toContain('Вёл переговоры с 12 поставщиками');
    expect(input.constraints).toContain('Контракт / interim');
  });

  it('appends review corrections to constraints instead of discarding them', () => {
    const input = buildOnboardingWorkspaceInput({
      sourceChoice: 'pdf',
      ingested: {
        parsed: parsedResume({ targetRole: 'VP' }),
        draft: { experience: [] } as never,
        text: 'a'.repeat(90),
        source: 'pdf',
        imported: true,
      },
      talk: { tasks: '', change: '', successMeasure: '' },
      selectedRoleTitle: 'VP',
      regions: [],
      format: 'Полная занятость',
      reviewOverrides: { 'job-0': 'На самом деле отчитывался напрямую СЕО' },
      linkedinUrl: '',
      hhUrl: '',
    });
    expect(input.constraints).toContain('На самом деле отчитывался напрямую СЕО');
  });
});
