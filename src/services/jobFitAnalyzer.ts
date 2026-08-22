import type { ResumeDraft } from '../features/resume/resumeTypes';

export interface VacancyTarget {
  id: string;
  title: string;
  company: string;
  description: string;
  requiredSkills: string[];
  preferredSkills?: string[];
  seniority?: string;
  domain?: string;
}

interface MatchFactor {
  score: number; // 0 - 100
  matched: string[];
  missing: string[];
  explanation: string;
}

export interface JobFitResult {
  vacancyId: string;
  vacancyTitle: string;
  company: string;
  overallScore: number; // 0 - 100
  verdict: string;
  hardSkillsMatch: MatchFactor;
  softSkillsMatch: MatchFactor;
  seniorityMatch: MatchFactor;
  domainMatch: MatchFactor;
  atsScore: number;
  gaps: Array<{
    category: 'hard_skill' | 'soft_skill' | 'domain' | 'seniority';
    name: string;
    importance: 'critical' | 'moderate' | 'nice_to_have';
    action: string;
  }>;
}

// eslint-disable-next-line max-lines-per-function
export function analyzeJobFit(
  draft: ResumeDraft,
  vacancy: VacancyTarget,
): JobFitResult {
  const skillsList = draft.skills ?? [];
  const candidateSkills = skillsList.map((s) => (s.name ?? '').toLowerCase());
  const expList = draft.experience ?? [];
  const resumeText = [
    draft.candidate.about || '',
    draft.targetRole || '',
    ...expList.map((e) => `${e.title || ''} ${e.employer || ''}`),
    ...skillsList.map((s) => s.name || ''),
  ].join(' ').toLowerCase();

  // 1. Hard skills analysis
  const reqSkills = vacancy.requiredSkills.map((s) => s.trim());
  const matchedHard: string[] = [];
  const missingHard: string[] = [];

  for (const skill of reqSkills) {
    const sLow = skill.toLowerCase();
    if (candidateSkills.some((cs) => cs.includes(sLow) || sLow.includes(cs)) || resumeText.includes(sLow)) {
      matchedHard.push(skill);
    } else {
      missingHard.push(skill);
    }
  }

  const hardScore = reqSkills.length > 0
    ? Math.round((matchedHard.length / reqSkills.length) * 100)
    : 80;

  // 2. Soft skills analysis
  const softKeywords = [
    'leadership',
    'лидер',
    'руководств',
    'управление',
    'коммуникация',
    'agile',
    'scrum',
    'architecture',
    'архитектура',
    'ментор',
    'наставничество',
    'команд',
  ];
  const matchedSoft: string[] = [];
  for (const kw of softKeywords) {
    if (resumeText.includes(kw)) {
      matchedSoft.push(kw);
    }
  }
  const softScore = Math.min(100, Math.max(50, matchedSoft.length * 20));

  // 3. Seniority match
  const expYears = Math.max(expList.length * 2, 5);
  const isCandidateSeniorOrLead = (draft.targetRole || '').toLowerCase().includes('lead') ||
    (draft.targetRole || '').toLowerCase().includes('head') ||
    (draft.targetRole || '').toLowerCase().includes('vp') ||
    (draft.targetRole || '').toLowerCase().includes('senior') ||
    expList.some((e) => (e.title ?? '').toLowerCase().includes('lead') || (e.title ?? '').toLowerCase().includes('vp') || (e.title ?? '').toLowerCase().includes('head'));

  const isTargetSeniorOrLead = (vacancy.seniority || vacancy.title).toLowerCase().includes('lead') ||
    (vacancy.seniority || vacancy.title).toLowerCase().includes('head') ||
    (vacancy.seniority || vacancy.title).toLowerCase().includes('vp') ||
    (vacancy.seniority || vacancy.title).toLowerCase().includes('senior');

  let seniorityScore = 80;
  if (isTargetSeniorOrLead) {
    seniorityScore = isCandidateSeniorOrLead ? 90 : expList.length >= 2 ? 80 : 60;
  }

  // 4. Domain match
  const domain = vacancy.domain?.toLowerCase() || '';
  let domainScore = 75;
  if (domain) {
    if (resumeText.includes(domain)) {
      domainScore = 95;
    } else {
      domainScore = 60;
    }
  }

  // 5. ATS Readability score
  const hasAbout = Boolean(draft.candidate.about);
  const hasExp = expList.length > 0;
  const hasSkills = skillsList.length >= 5;
  const atsScore = Math.round(
    (hasAbout ? 30 : 15) + (hasExp ? 40 : 10) + (hasSkills ? 30 : 15),
  );

  // Overall score: weighted average
  const overallScore = Math.round(
    hardScore * 0.45 + softScore * 0.2 + seniorityScore * 0.2 + domainScore * 0.15,
  );

  let verdict = 'Умеренное соответствие';
  if (overallScore >= 80) {
    verdict = 'Сильное соответствие: высокий шанс приглашения на интервью';
  } else if (overallScore >= 65) {
    verdict = 'Хорошее соответствие с точечными пробелами в ключевых навыках';
  } else {
    verdict = 'Низкое соответствие: требуются существенные доработки опыта и стека';
  }

  const gaps: JobFitResult['gaps'] = missingHard.map((skill) => ({
    category: 'hard_skill',
    name: skill,
    importance: 'critical',
    action: `Добавить упоминание и практические примеры работы с ${skill} в блок опыта и навыков.`,
  }));

  return {
    vacancyId: vacancy.id,
    vacancyTitle: vacancy.title,
    company: vacancy.company,
    overallScore,
    verdict,
    hardSkillsMatch: {
      score: hardScore,
      matched: matchedHard,
      missing: missingHard,
      explanation: `Найдено ${matchedHard.length} из ${reqSkills.length} обязательных hard skills позиции.`,
    },
    softSkillsMatch: {
      score: softScore,
      matched: matchedSoft,
      missing: [],
      explanation: `Подтверждено ${matchedSoft.length} сигналов лидерских и процессных компетенций.`,
    },
    seniorityMatch: {
      score: seniorityScore,
      matched: [vacancy.seniority || 'Релевантный уровень'],
      missing: [],
      explanation: `Опыт кандидата (${expYears}+ лет) соответствует требуемому уровню позиции.`,
    },
    domainMatch: {
      score: domainScore,
      matched: domain ? [domain] : [],
      missing: [],
      explanation: domain ? `Оценка релевантности домену ${vacancy.domain}` : 'Общий доменный контекст',
    },
    atsScore,
    gaps,
  };
}
