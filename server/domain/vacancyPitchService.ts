import { stripHiddenMarkers } from '../../shared/textHygiene';

export type PitchTone = 'executive' | 'confident' | 'technical';

export interface VacancyPitchInputFact {
  readonly id: string;
  readonly statement: string;
  readonly domain?: string;
  readonly kind?: string;
  readonly status?: 'proposed' | 'confirmed' | 'corrected';
}

export interface VacancyPitchInputVacancy {
  readonly id: string;
  readonly title: string;
  readonly company?: string;
  readonly description?: string;
  readonly requiredSkills?: readonly string[];
  readonly responsibilities?: readonly string[];
  readonly location?: string;
  readonly isRemote?: boolean;
}

export interface GenerateVacancyPitchOptions {
  readonly vacancy: VacancyPitchInputVacancy;
  readonly candidateName?: string;
  readonly facts: readonly VacancyPitchInputFact[];
  readonly tone?: PitchTone;
}

export interface VacancyPitchResponse {
  readonly vacancyId: string;
  readonly emailPitch: {
    readonly subject: string;
    readonly body: string;
  };
  readonly linkedInNote: string;
  readonly atsCoverLetter: string;
  readonly usedEvidenceIds: readonly string[];
  readonly generatedAt: string;
}

const LINKEDIN_NOTE_LIMIT = 300;

function filterConfirmedFacts(facts: readonly VacancyPitchInputFact[]): VacancyPitchInputFact[] {
  return facts.filter(
    (fact) => !fact.status || fact.status === 'confirmed' || fact.status === 'corrected',
  );
}

function truncateSafely(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const sliced = text.slice(0, maxLen - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const boundary = lastSpace > maxLen / 2 ? lastSpace : maxLen - 1;
  const trimmed = sliced.slice(0, boundary).trim();
  const punct = /[.,;!?-]$/u.test(trimmed) ? '' : '.';
  return `${trimmed}${punct}`;
}

function extractSkillWords(fact: VacancyPitchInputFact): string[] {
  return fact.statement
    .split(/[,;:|/•·\n]/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 40);
}

function buildSubject(
  title: string,
  candidateName: string,
  tone: PitchTone,
  metricHighlight?: string,
): string {
  if (tone === 'technical') {
    return `${title} — ${candidateName} | Инженерная экспертиза и стек`;
  }
  if (tone === 'confident') {
    return `Отклик на позицию ${title}: ${candidateName} — подтверждённый опыт и результаты`;
  }
  const suffix = metricHighlight ? `Результаты и масштаб` : 'Масштабирование процессов и результаты';
  return `${title} — ${candidateName} | ${suffix}`;
}

function buildIntroParagraph(
  title: string,
  company: string | undefined,
  tone: PitchTone,
): string {
  const target = company ? `компании ${company}` : 'вашей команды';
  if (tone === 'technical') {
    return `Здравствуйте! Заинтересовала вакансия ${title} в ${target}. В инженерной практике фокусируюсь на надежности систем, архитектуре и высокой производительности сервисов.`;
  }
  if (tone === 'confident') {
    return `Здравствуйте! Направляю отклик на вакансию ${title} в ${target}. Мой подтверждённый опыт напрямую отвечает ключевым задачам роли, готов сразу включиться в решение приоритетов.`;
  }
  return `Здравствуйте! Заинтересовала позиция ${title} в ${target}. В управлении процессами опираюсь на системный подход, масштабирование команд и достижение измеримых бизнес-результатов.`;
}

function buildEvidenceParagraph(
  facts: readonly VacancyPitchInputFact[],
  usedIds: Set<string>,
): string {
  if (facts.length === 0) {
    return 'Обладаю практическим опытом решения аналогичных задач и готов применить свои навыки для усиления команды.';
  }
  const metricFact = facts.find(
    (f) => f.domain === 'outcome' || /\d+/u.test(f.statement),
  ) ?? facts[0];
  if (metricFact) {
    usedIds.add(metricFact.id);
  }
  const otherFacts = facts.filter((f) => f.id !== metricFact?.id).slice(0, 2);
  for (const f of otherFacts) {
    usedIds.add(f.id);
  }
  const statements = [metricFact?.statement, ...otherFacts.map((f) => f.statement)].filter(
    (s): s is string => Boolean(s),
  );
  return `В подтверждённом опыте опираюсь на измеримые результаты: ${statements.join('. ')}.`;
}

function buildStackParagraph(
  vacancy: VacancyPitchInputVacancy,
  facts: readonly VacancyPitchInputFact[],
  usedIds: Set<string>,
  tone: PitchTone,
): string {
  const reqSkills = vacancy.requiredSkills ?? [];
  if (reqSkills.length === 0) {
    return tone === 'technical'
      ? 'Готов перенести инженерные стандарты и архитектурные решения в контекст задач продукта.'
      : 'Готов перенести проверенные управленческие и продуктовые практики на задачи проекта.';
  }

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (const req of reqSkills) {
    const matchedFact = facts.find((f) =>
      f.statement.toLocaleLowerCase('ru-RU').includes(req.toLocaleLowerCase('ru-RU')),
    );
    if (matchedFact) {
      matchedSkills.push(req);
      usedIds.add(matchedFact.id);
    } else {
      missingSkills.push(req);
    }
  }

  const parts: string[] = [];
  if (matchedSkills.length > 0) {
    parts.push(`В профиле подтверждён практический опыт работы со стеком: ${matchedSkills.join(', ')}`);
  }

  if (missingSkills.length > 0) {
    const candidateSkillsFact = facts.find((f) => f.domain === 'skill') ?? facts[0];
    let adjacentLabel = 'смежные технологии';
    if (candidateSkillsFact) {
      usedIds.add(candidateSkillsFact.id);
      const words = extractSkillWords(candidateSkillsFact);
      if (words.length > 0) {
        adjacentLabel = words.slice(0, 3).join(', ');
      }
    }
    const missingSample = missingSkills.slice(0, 3).join(', ');
    parts.push(
      `В отношении требований к ${missingSample} опираюсь на релевантный смежный фундамент (${adjacentLabel}) и готов к быстрому освоению специфики инфраструктуры`,
    );
  }

  return `${parts.join('. ')}.`;
}

function buildClosingParagraph(tone: PitchTone): string {
  if (tone === 'technical') {
    return 'Буду рад ответить на технические вопросы и разобрать архитектурные кейсы на короткой встрече.';
  }
  if (tone === 'confident') {
    return 'Предлагаю созвониться на 15 минут, чтобы предметно обсудить задачи и взаимные ожидания.';
  }
  return 'Буду рад обсудить цели роли и приоритеты бизнеса на коротком звонке. Резюме во вложении.';
}

function buildLinkedInNote(
  vacancy: VacancyPitchInputVacancy,
  facts: readonly VacancyPitchInputFact[],
  tone: PitchTone,
  usedIds: Set<string>,
): string {
  const companyPart = vacancy.company ? ` в ${vacancy.company}` : '';
  const firstFact = facts.find((f) => f.domain === 'outcome' || /\d+/u.test(f.statement)) ?? facts[0];
  let snippet = '';
  if (firstFact) {
    usedIds.add(firstFact.id);
    snippet = ` Мой опыт: ${firstFact.statement}.`;
  }

  let note = '';
  if (tone === 'technical') {
    note = `Здравствуйте! Заинтересовала позиция ${vacancy.title}${companyPart}.${snippet} Буду рад обсудить инженерные вызовы и добавить вас в сеть!`;
  } else if (tone === 'confident') {
    note = `Здравствуйте! Откликаюсь на роль ${vacancy.title}${companyPart}.${snippet} Готов обсудить задачи на коротком звонке, рад знакомству!`;
  } else {
    note = `Здравствуйте! Заинтересовала роль ${vacancy.title}${companyPart}.${snippet} Буду рад обсудить задачи команды и добавить вас в сеть контактов!`;
  }

  return truncateSafely(note, LINKEDIN_NOTE_LIMIT);
}

function buildAtsCoverLetter(
  vacancy: VacancyPitchInputVacancy,
  candidateName: string,
  intro: string,
  evidence: string,
  stack: string,
  closing: string,
): string {
  const companyLine = vacancy.company ? `компании ${vacancy.company}` : 'вашей команды';
  return [
    `Кому: Нанимающей команде ${companyLine}`,
    `Позиция: ${vacancy.title}`,
    `Кандидат: ${candidateName}`,
    '',
    `Уважаемая команда${vacancy.company ? ` ${vacancy.company}` : ''}!`,
    '',
    intro,
    '',
    'Ключевые подтверждённые результаты:',
    evidence,
    '',
    'Соответствие требованиям роли:',
    stack,
    '',
    closing,
    '',
    'С уважением,',
    candidateName,
  ].join('\n');
}

export function generateVacancyPitch(
  options: GenerateVacancyPitchOptions,
): VacancyPitchResponse {
  const { vacancy, tone = 'executive' } = options;
  const candidateName = options.candidateName?.trim() || 'Кандидат';
  const confirmedFacts = filterConfirmedFacts(options.facts);
  const usedEvidenceIds = new Set<string>();

  const metricFact = confirmedFacts.find((f) => /\d+/u.test(f.statement));
  const subject = buildSubject(vacancy.title, candidateName, tone, metricFact?.statement);

  const intro = buildIntroParagraph(vacancy.title, vacancy.company, tone);
  const evidence = buildEvidenceParagraph(confirmedFacts, usedEvidenceIds);
  const stack = buildStackParagraph(vacancy, confirmedFacts, usedEvidenceIds, tone);
  const closing = buildClosingParagraph(tone);

  const emailBody = [intro, evidence, stack, closing].join('\n\n');
  const linkedInNote = buildLinkedInNote(vacancy, confirmedFacts, tone, usedEvidenceIds);
  const atsCoverLetter = buildAtsCoverLetter(
    vacancy,
    candidateName,
    intro,
    evidence,
    stack,
    closing,
  );

  return {
    vacancyId: vacancy.id,
    emailPitch: {
      subject: stripHiddenMarkers(subject),
      body: stripHiddenMarkers(emailBody),
    },
    linkedInNote: stripHiddenMarkers(linkedInNote),
    atsCoverLetter: stripHiddenMarkers(atsCoverLetter),
    usedEvidenceIds: Array.from(usedEvidenceIds),
    generatedAt: new Date().toISOString(),
  };
}
