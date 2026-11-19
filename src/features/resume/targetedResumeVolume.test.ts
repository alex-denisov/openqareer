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
  it('never drops a place: trims irrelevant bullets oldest place first and keeps a minimum per place (B713)', () => {
    const irrelevant = (prefix: string) => Array.from(
      { length: 40 },
      (_, index) => `${prefix}: поддерживала внутренние процессы и готовила отчёты для команды ${index}.`,
    );
    const target = sliceOf([
      role('newer', '2018', 'Менеджер процессов', irrelevant('newer')),
      role('relevant', '2023', 'Инженер платформы', [
        'Поддерживала Kubernetes в производственных сервисах.',
        ...irrelevant('relevant'),
      ]),
      role('oldest', '2010', 'Менеджер по продажам', irrelevant('oldest')),
    ]);

    const result = estimateResumePages(target);

    expect(result.pages).toBeLessThanOrEqual(2);
    expect(result.trimmed.every((item) => item.kind === 'bullet')).toBe(true);
    expect(result.trimmed[0]?.id).toMatch(/^bullet:oldest:/u);
    expect(result.trimmed.every((item) => item.reason.length > 0)).toBe(true);
    expect(result.document.experience.map((item) => item.id).sort()).toEqual(['newer', 'oldest', 'relevant']);
    for (const place of result.document.experience) {
      expect(place.bullets.length).toBeGreaterThanOrEqual(2);
    }
    expect(result.document.experience.find((item) => item.id === 'relevant')?.bullets[0]?.value)
      .toBe('Поддерживала Kubernetes в производственных сервисах.');
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
