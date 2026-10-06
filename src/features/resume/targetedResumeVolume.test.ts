import { describe, expect, it } from 'vitest';
import { buildTargetedResumeSlice } from '../../../server/domain/resumeStudio';
import type { ResumeAssertion, ResumeDocument, ResumeExperience } from './resumeTypes';
import { estimateResumePages } from './targetedResumeVolume';

function fact<Value extends string | boolean = string>(
  value: Value,
  memoryId: string,
): ResumeAssertion<Value> {
  return { value, memoryId, sourceMessageIds: [`message-${memoryId}`], reviewFlags: [] };
}

function role(
  id: string,
  startYear: string,
  title: string,
  bullets: readonly string[],
): ResumeExperience {
  return {
    id,
    title: fact(title, `${id}-title`),
    employer: fact(`${id} company`, `${id}-employer`),
    location: null,
    startDate: fact(startYear, `${id}-start`),
    endDate: null,
    current: fact(false, `${id}-current`),
    bullets: bullets.map((bullet, index) => fact(bullet, `${id}-bullet-${index}`)),
  };
}

function master(experience: readonly ResumeExperience[]): ResumeDocument {
  return {
    kind: 'master',
    targetRole: 'Инженер платформы',
    contact: {
      fullName: 'Анна Пример',
      email: 'anna@example.test',
      phone: null,
      location: 'Москва',
      links: [],
    },
    about: 'Инженер платформы с опытом разработки сервисов.',
    experience,
    education: [],
    languages: [],
    projects: [],
    skills: [],
    courses: [],
    tests: [],
    recommendations: [],
    additional: {},
    unknowns: [],
    conventions: {
      country: null,
      packVersion: null,
      reverseChronological: true,
      maxPages: null,
      recommendedBulletsPerRole: null,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    },
    length: { lines: 10, pages: 1, linesPerPage: 45 },
  };
}

function sliceOf(experience: readonly ResumeExperience[]) {
  return buildTargetedResumeSlice(master(experience), {
    title: 'Инженер платформы',
    requirements: ['Kubernetes'],
  });
}

describe('estimateResumePages', () => {
  it('trims irrelevant experience oldest first, then irrelevant bullets, to at most two pages', () => {
    const longIrrelevantBullets = Array.from(
      { length: 100 },
      () => 'Поддерживала внутренние процессы и готовила отчёты для команды.',
    );
    const target = sliceOf([
      role('newer', '2018', 'Менеджер процессов', []),
      role('relevant', '2023', 'Инженер платформы', [
        'Поддерживала Kubernetes в производственных сервисах.',
        ...longIrrelevantBullets,
      ]),
      role('oldest', '2010', 'Менеджер по продажам', []),
    ]);

    const result = estimateResumePages(target);

    expect(result.pages).toBeLessThanOrEqual(2);
    expect(result.trimmed.slice(0, 2).map((item) => item.id)).toEqual([
      'experience:oldest',
      'experience:newer',
    ]);
    expect(result.trimmed.some((item) => item.kind === 'bullet')).toBe(true);
    expect(result.trimmed.every((item) => item.reason.length > 0)).toBe(true);
    expect(result.document.experience.map((item) => item.id)).toEqual(['relevant']);
  });

  it('leaves a short targeted resume unchanged', () => {
    const target = sliceOf([
      role('relevant', '2023', 'Инженер платформы', [
        'Поддерживала Kubernetes в производственных сервисах.',
      ]),
    ]);

    const result = estimateResumePages(target);

    expect(result.pages).toBe(1);
    expect(result.trimmed).toEqual([]);
    expect(result.warning).toBeNull();
    expect(result.document.experience[0]?.bullets).toHaveLength(1);
  });

  it('returns the remaining page count and warning when only relevant facts remain', () => {
    const relevantBullets = Array.from(
      { length: 90 },
      (_, index) => `Поддерживала Kubernetes и проверяла версию сервиса ${index}.`,
    );
    const target = sliceOf([role('relevant', '2023', 'Инженер платформы', relevantBullets)]);

    const result = estimateResumePages(target);

    expect(result.pages).toBeGreaterThan(2);
    expect(result.warning).toContain(String(result.pages));
    expect(result.trimmed).toEqual([]);
    expect(result.document.experience[0]?.bullets).toHaveLength(relevantBullets.length);
  });
});
