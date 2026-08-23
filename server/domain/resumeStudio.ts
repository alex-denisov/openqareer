import type {
  ResumeAdditionalInput,
  ResumeCandidateInput,
  ResumeCourseInput,
  ResumeEducationInput,
  ResumeExperienceInput,
  ResumeLanguageInput,
  ResumeRecommendationInput,
  ResumeSkillInput,
  ResumeTestInput,
} from './resumeDraft';
import type {
  NormalizedEvidence,
  ProjectionContext,
  ResumeAssertion,
  ResumeContact,
  ResumeDocument,
  ResumeEducation,
  ResumeExperience,
  ResumeLanguage,
  ResumeLengthEstimate,
  ResumeStudioProjection,
  ResumeUnknown,
} from './resumeStudioTypes';
import type { ResumeConventions, ResumeStudioInput } from './resumeStudioTypes';
import {
  buildEvidenceCatalog,
  clean,
  compareExperienceReverseChronologically,
  estimateLength,
  evidenceSnapshot,
  isResumeDate,
  GERMANY_MAX_PAGES,
  optionalAssertion,
  assertion,
  claimAssertion,
  dateRank,
  unknown as makeUnknown,
  validCefr,
  resolveEvidence,
} from './resumeStudioInternals';

export type {
  ResumeAssertion,
  ResumeDocument,
  ResumeEvidence,
  ResumeEvidenceFreshness,
  ResumeEvidenceSnapshot,
  ResumeEducation,
  ResumeExperience,
  ResumeLanguage,
  ResumeReviewFlag,
  ResumeStudioInput,
  ResumeStudioProjection,
  ResumeConventions,
  ResumeUnknown,
  StaleEvidenceReason,
} from './resumeStudioTypes';
export type { CefrLevel, ResumeDraft } from './resumeDraft';
export { validateResumeEvidenceFreshness } from './resumeStudioInternals';

const MASTER_CONVENTIONS: ResumeConventions = {
  country: null,
  packVersion: null,
  reverseChronological: false,
  maxPages: null,
  recommendedBulletsPerRole: null,
  photo: 'omitted',
  discriminatoryPii: 'omitted',
};

const GERMANY_CONVENTIONS: ResumeConventions = {
  country: 'DE',
  packVersion: 'DE-CV-2026.1',
  reverseChronological: true,
  maxPages: 2,
  recommendedBulletsPerRole: { min: 3, max: 5 },
  photo: 'omitted',
  discriminatoryPii: 'omitted',
};

// eslint-disable-next-line max-lines-per-function
export function buildResumeStudioProjection(
  input: ResumeStudioInput,
): ResumeStudioProjection {
  const context: ProjectionContext = {
    catalog: buildEvidenceCatalog(input.evidence),
    usedEvidenceIds: new Set<string>(),
    excludedEvidenceIds: new Set<string>(),
    unknowns: identityUnknowns(input.candidate),
  };
  const contact = projectContact(input.candidate);
  const experience = projectExperience(input.experience, context);
  const education = projectEducation(input.education, context);
  const languages = projectLanguages(input.languages, context);
  const skills = input.skills ?? [];
  const courses = input.courses ?? [];
  const tests = input.tests ?? [];
  const recommendations = input.recommendations ?? [];
  const about = clean(input.candidate.about);
  const photoUrl = clean(input.candidate.photoUrl);
  const additional = input.additional ?? null;
  addSectionUnknowns(experience, education, languages, context.unknowns);
  const masterUnknowns = [...context.unknowns];
  return {
    master: document(
      'master',
      null,
      contact,
      about,
      photoUrl,
      experience,
      skills,
      education,
      courses,
      tests,
      recommendations,
      languages,
      additional,
      masterUnknowns,
      estimateLength(contact, experience, education, languages),
    ),
    germanyVariant: germanyDocument(input.targetRole, contact, {
      about,
      photoUrl,
      experience,
      skills,
      education,
      courses,
      tests,
      recommendations,
      languages,
      additional,
      commonUnknowns: masterUnknowns,
    }),
    evidenceSnapshot: evidenceSnapshot(context),
    excludedEvidenceIds: [...context.excludedEvidenceIds].sort(),
  };
}

function germanyVariantUnknowns(
  targetRole: string | undefined,
  experience: readonly ResumeExperience[],
  common: readonly ResumeUnknown[],
  length: ResumeLengthEstimate,
): ResumeUnknown[] {
  const unknowns = [...common];
  if (!clean(targetRole)) {
    unknowns.push({
      ...makeUnknown('missing-target-role', 'Укажите целевую роль для версии DE.'),
      scope: 'DE',
    });
  }
  for (const role of experience) {
    if (role.bullets.length < 3 || role.bullets.length > 5) {
      unknowns.push({
        ...makeUnknown(
          'germany-bullet-count',
          'Для версии DE проверьте диапазон от трёх до пяти пунктов на роль.',
          role.id,
          false,
        ),
        scope: 'DE',
      });
    }
  }
  if (length.pages > GERMANY_MAX_PAGES) {
    unknowns.push({
      ...makeUnknown(
        'germany-length-exceeds-two-pages',
        `Версия DE занимает примерно ${length.pages} страницы при пределе ${GERMANY_MAX_PAGES}: сократите формулировки, не удаляя подтверждённые факты.`,
      ),
      scope: 'DE',
    });
  }
  return unknowns;
}


interface GermanySections {
  readonly about?: string | null;
  readonly photoUrl?: string | null;
  readonly experience: readonly ResumeExperience[];
  readonly skills?: readonly ResumeSkillInput[];
  readonly education: readonly ResumeEducation[];
  readonly courses?: readonly ResumeCourseInput[];
  readonly tests?: readonly ResumeTestInput[];
  readonly recommendations?: readonly ResumeRecommendationInput[];
  readonly languages: readonly ResumeLanguage[];
  readonly additional?: ResumeAdditionalInput | null;
  readonly commonUnknowns: readonly ResumeUnknown[];
}

function germanyDocument(
  targetRole: string | undefined,
  contact: ResumeContact,
  sections: GermanySections,
): ResumeDocument {
  const experience = [...sections.experience].sort(
    compareExperienceReverseChronologically,
  );
  const length = estimateLength(
    contact,
    experience,
    sections.education,
    sections.languages,
  );
  return document(
    'country-role',
    clean(targetRole),
    contact,
    sections.about,
    sections.photoUrl,
    experience,
    sections.skills,
    sections.education,
    sections.courses,
    sections.tests,
    sections.recommendations,
    sections.languages,
    sections.additional,
    germanyVariantUnknowns(
      targetRole,
      experience,
      sections.commonUnknowns,
      length,
    ),
    length,
  );
}

function projectContact(candidate: ResumeCandidateInput): ResumeContact {
  return {
    fullName: clean(candidate.fullName),
    email: clean(candidate.contact?.email),
    phone: clean(candidate.contact?.phone),
    telegram: clean(candidate.contact?.telegram),
    location: clean(candidate.contact?.location),
    links: (candidate.contact?.links ?? []).flatMap((link) => {
      const normalized = clean(link);
      return normalized ? [normalized] : [];
    }),
  };
}

function identityUnknowns(candidate: ResumeCandidateInput): ResumeUnknown[] {
  const unknowns: ResumeUnknown[] = [];
  if (!clean(candidate.fullName)) {
    unknowns.push(makeUnknown('missing-full-name', 'Укажите имя для заголовка резюме.'));
  }
  if (!clean(candidate.contact?.email) && !clean(candidate.contact?.phone)) {
    unknowns.push(
      makeUnknown('missing-contact', 'Укажите email или телефон для связи.'),
    );
  }
  return unknowns;
}

function projectExperience(
  input: readonly ResumeExperienceInput[],
  context: ProjectionContext,
): ResumeExperience[] {
  return input.flatMap((role) => {
    const chronology = resolveEvidence(role.chronologyMemoryId, context, role.id);
    if (!chronology) return [];
    addRoleUnknowns(role, context.unknowns);
    const bullets = role.bulletMemoryIds.flatMap((memoryId) => {
      const evidence = resolveEvidence(memoryId, context, role.id);
      return evidence ? [claimAssertion(evidence)] : [];
    });
    if (bullets.length === 0) {
      context.unknowns.push(
        makeUnknown(
          'missing-role-claims',
          'Добавьте подтверждённый результат или ответственность для роли.',
          role.id,
        ),
      );
    }
    return [experienceFrom(role, chronology, bullets)];
  });
}

function experienceFrom(
  role: ResumeExperienceInput,
  evidence: NormalizedEvidence,
  bullets: readonly ResumeAssertion[],
): ResumeExperience {
  return {
    id: role.id,
    title: optionalAssertion(role.title, evidence),
    employer: optionalAssertion(role.employer, evidence),
    location: optionalAssertion(role.location, evidence),
    startDate: optionalAssertion(role.startDate, evidence),
    endDate: role.current ? null : optionalAssertion(role.endDate, evidence),
    current: assertion(role.current, evidence),
    bullets,
  };
}

function addRoleUnknowns(
  role: ResumeExperienceInput,
  unknowns: ResumeUnknown[],
): void {
  if (!clean(role.title)) {
    unknowns.push(makeUnknown('missing-role-title', 'Укажите название роли.', role.id));
  }
  if (!clean(role.employer)) {
    unknowns.push(makeUnknown('missing-employer', 'Укажите работодателя.', role.id));
  }
  if (!clean(role.startDate)) {
    unknowns.push(
      makeUnknown('missing-role-start-date', 'Укажите дату начала роли.', role.id),
    );
  }
  if (!role.current && !clean(role.endDate)) {
    unknowns.push(
      makeUnknown('missing-role-end-date', 'Укажите дату окончания роли.', role.id),
    );
  }
  addChronologyIssues(role, unknowns);
}

function addChronologyIssues(
  role: ResumeExperienceInput,
  unknowns: ResumeUnknown[],
): void {
  const start = clean(role.startDate);
  const end = clean(role.endDate);
  for (const value of [start, end]) {
    if (value && !isResumeDate(value)) {
      unknowns.push(
        makeUnknown('invalid-chronology-date', `Проверьте дату «${value}».`, role.id),
      );
    }
  }
  const startRank = dateRank(start);
  const endRank = dateRank(end);
  if (
    (role.current && end) ||
    (!role.current && startRank !== null && endRank !== null && startRank > endRank)
  ) {
    unknowns.push(
      makeUnknown(
        'chronology-conflict',
        'Даты роли противоречат друг другу и требуют подтверждения.',
        role.id,
      ),
    );
  }
}

function projectEducation(
  input: readonly ResumeEducationInput[],
  context: ProjectionContext,
): ResumeEducation[] {
  return input.flatMap((item) => {
    const evidence = resolveEvidence(item.evidenceMemoryId, context, item.id);
    if (!evidence) return [];
    if (!clean(item.institution) || !clean(item.qualification)) {
      context.unknowns.push(
        makeUnknown(
          'missing-education-details',
          'Уточните учебное заведение и квалификацию.',
          item.id,
        ),
      );
    }
    return [
      {
        id: item.id,
        institution: optionalAssertion(item.institution, evidence),
        qualification: optionalAssertion(item.qualification, evidence),
        startDate: optionalAssertion(item.startDate, evidence),
        endDate: optionalAssertion(item.endDate, evidence),
      },
    ];
  });
}

function projectLanguages(
  input: readonly ResumeLanguageInput[],
  context: ProjectionContext,
): ResumeLanguage[] {
  return input.flatMap((item) => {
    const evidence = resolveEvidence(item.evidenceMemoryId, context, item.id);
    if (!evidence) return [];
    if (!clean(item.name)) {
      context.unknowns.push(
        makeUnknown('missing-language-name', 'Укажите язык.', item.id),
      );
    }
    const cefr = validCefr(item.cefr);
    if (!cefr) {
      context.unknowns.push(
        makeUnknown(
          'missing-language-level',
          'Укажите подтверждённый уровень CEFR от A1 до C2.',
          item.id,
        ),
      );
    }
    return [
      {
        id: item.id,
        name: optionalAssertion(item.name, evidence),
        cefr: cefr ? assertion(cefr, evidence) : null,
      },
    ];
  });
}

function addSectionUnknowns(
  experience: readonly ResumeExperience[],
  education: readonly ResumeEducation[],
  languages: readonly ResumeLanguage[],
  unknowns: ResumeUnknown[],
): void {
  if (experience.length === 0) {
    unknowns.push(
      makeUnknown(
        'missing-role-chronology',
        'Добавьте хотя бы одну подтверждённую роль с датами.',
      ),
    );
  }
  if (education.length === 0) {
    unknowns.push(
      makeUnknown('missing-education', 'Добавьте подтверждённое образование.'),
    );
  }
  if (languages.length === 0) {
    unknowns.push(
      makeUnknown(
        'missing-language-level',
        'Добавьте язык и подтверждённый уровень CEFR.',
      ),
    );
  }
}

function document(
  kind: ResumeDocument['kind'],
  targetRole: string | null,
  contact: ResumeContact,
  about: string | null | undefined,
  photoUrl: string | null | undefined,
  experience: readonly ResumeExperience[],
  skills: readonly ResumeSkillInput[] | undefined,
  education: readonly ResumeEducation[],
  courses: readonly ResumeCourseInput[] | undefined,
  tests: readonly ResumeTestInput[] | undefined,
  recommendations: readonly ResumeRecommendationInput[] | undefined,
  languages: readonly ResumeLanguage[],
  additional: ResumeAdditionalInput | null | undefined,
  unknowns: readonly ResumeUnknown[],
  length: ResumeLengthEstimate,
): ResumeDocument {
  return {
    kind,
    targetRole,
    contact,
    about: about ?? null,
    photoUrl: photoUrl ?? null,
    experience,
    skills: skills ?? [],
    education,
    courses: courses ?? [],
    tests: tests ?? [],
    recommendations: recommendations ?? [],
    languages,
    additional: additional ?? null,
    unknowns,
    conventions: kind === 'master' ? MASTER_CONVENTIONS : GERMANY_CONVENTIONS,
    length,
  };
}
