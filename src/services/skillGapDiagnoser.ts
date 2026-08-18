import type { ResumeDraft } from '../features/resume/resumeTypes';

export interface SkillGap {
  skill: string;
  category: 'core' | 'framework' | 'tooling' | 'leadership';
  impact: 'high' | 'medium' | 'low';
  currentPresence: boolean;
  recommendedAction: string;
}

export interface XyzBulletRecommendation {
  originalText: string;
  formattedText: string;
  standard: 'Google XYZ';
  explanation: string;
}

const ROLE_SKILL_BENCHMARKS: Record<string, string[]> = {
  'frontend': ['TypeScript', 'React', 'JavaScript', 'HTML/CSS', 'Next.js', 'State Management', 'Web Performance', 'Testing (Jest/Vitest)'],
  'backend': ['Node.js', 'TypeScript', 'PostgreSQL', 'Microservices', 'Docker', 'Redis', 'API Design', 'System Architecture'],
  'fullstack': ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'CI/CD', 'REST/GraphQL'],
  'engineering lead': ['Team Leadership', 'System Architecture', 'Agile/Scrum', 'Hiring', 'Delivery Management', 'Code Review', 'Cloud/DevOps'],
  'product manager': ['Product Discovery', 'Unit Economics', 'Roadmapping', 'User Research', 'Data Analytics', 'A/B Testing', 'Stakeholder Management'],
  'qa': ['Test Automation', 'Playwright/Cypress', 'API Testing', 'TypeScript/Python', 'CI/CD', 'Bug Tracking', 'Test Strategy'],
};

export function diagnoseSkillGaps(
  draft: ResumeDraft,
  targetRole: string = '',
): SkillGap[] {
  const roleKey = Object.keys(ROLE_SKILL_BENCHMARKS).find((k) =>
    (targetRole || draft.targetRole || '').toLowerCase().includes(k),
  ) || 'frontend';

  const benchmarkSkills = ROLE_SKILL_BENCHMARKS[roleKey] || ROLE_SKILL_BENCHMARKS.frontend;
  const skillsList = draft.skills ?? [];
  const candidateSkills = skillsList.map((s) => (s.name ?? '').toLowerCase());
  const expList = draft.experience ?? [];
  const candidateText = [
    draft.candidate.about || '',
    ...expList.map((e) => `${e.title || ''} ${e.employer || ''}`),
  ].join(' ').toLowerCase();

  const gaps: SkillGap[] = [];

  for (const skill of benchmarkSkills) {
    const sLow = skill.toLowerCase();
    const hasSkill = candidateSkills.some((cs) => cs.includes(sLow) || sLow.includes(cs)) || candidateText.includes(sLow);

    if (!hasSkill) {
      gaps.push({
        skill,
        category: skill.includes('Leadership') || skill.includes('Management') ? 'leadership' : 'core',
        impact: 'high',
        currentPresence: false,
        recommendedAction: `Добавьте навык «${skill}» в список навыков и опишите проектный опыт его применения в блоке опыта работы.`,
      });
    }
  }

  return gaps;
}

export function generateXyzBulletRecommendation(
  originalText: string,
  parameters?: { metric?: string; method?: string },
): XyzBulletRecommendation {
  const metricPart = parameters?.metric || 'увеличил пропускную способность на 30% и сократил издержки';
  const methodPart = parameters?.method || 'оптимизации архитектуры и внедрения лучших инженерных практик';

  const cleanOriginal = originalText.trim().replace(/\.$/u, '');
  const formattedText = `${cleanOriginal}, что позволило достичь [${metricPart}] за счет [${methodPart}].`;

  return {
    originalText,
    formattedText,
    standard: 'Google XYZ',
    explanation: 'Формула Google XYZ: «Достиг [X], измеримо через [Y], с помощью [Z]» — превращает описательный текст обязанностей в сильный продуктовый результат.',
  };
}
