import type { ResumeDraft } from '../resume/resumeTypes';
import type { ProfileFact } from './profileIngestion';
import type { ParsedResume, ProfileFactDraft } from './resumeParser';

// eslint-disable-next-line max-lines-per-function
export function parsedResumeToDraft(parsed: ParsedResume): ResumeDraft {
  return {
    schemaVersion: 2,
    candidate: {
      fullName: parsed.fullName,
      photoUrl: parsed.photoUrl,
      headline: parsed.headline,
      about: parsed.about,
      contact: {
        email: parsed.contact.email,
        phone: parsed.contact.phone,
        telegram: parsed.contact.telegram,
        location: parsed.contact.location,
        links: parsed.contact.links,
        linkedinUrl: parsed.contact.linkedinUrl,
      },
    },
    targetRole: parsed.targetRole,
    experience: parsed.experience.map((exp, index) => ({
      id: `exp-${index + 1}`,
      chronologyMemoryId: `mem-exp-${index + 1}`,
      title: exp.title,
      employer: exp.employer,
      location: exp.location,
      startDate: exp.startDate,
      endDate: exp.endDate,
      current: exp.current,
      bulletMemoryIds: [
        ...exp.responsibilities.map((_, i) => `mem-bullet-${index + 1}-${i + 1}`),
        ...exp.achievements.map((_, i) => `mem-achieve-${index + 1}-${i + 1}`),
      ].slice(0, 12),
    })),
    skills: parsed.skills.map((skill, index) => ({
      id: `skill-${index + 1}`,
      name: skill,
    })),
    education: parsed.education.map((edu, index) => ({
      id: `edu-${index + 1}`,
      evidenceMemoryId: `mem-edu-${index + 1}`,
      institution: edu.institution,
      qualification: edu.qualification,
      startDate: edu.startDate,
      endDate: edu.endDate,
    })),
    courses: parsed.courses.map((course, index) => ({
      id: `course-${index + 1}`,
      name: course.name,
      institution: course.institution,
      year: course.year,
      certificateUrl: course.certificateUrl,
    })),
    tests: parsed.tests.map((test, index) => ({
      id: `test-${index + 1}`,
      name: test.name,
      provider: test.provider,
      score: test.score,
      year: test.year,
    })),
    recommendations: parsed.recommendations.map((rec, index) => ({
      id: `rec-${index + 1}`,
      recommender: rec.recommender,
      organization: rec.organization,
      position: rec.position,
      text: rec.text,
      contact: rec.contact,
    })),
    languages: parsed.languages.map((lang, index) => ({
      id: `lang-${index + 1}`,
      evidenceMemoryId: `mem-lang-${index + 1}`,
      name: lang.name,
      cefr: lang.cefr,
    })),
    additional: parsed.additional,
    certifications: parsed.certifications?.map((cert, index) => ({
      id: `cert-${index + 1}`,
      name: cert.name,
      issuer: cert.issuer,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
      credentialId: cert.credentialId,
      url: cert.url,
    })),
    projects: parsed.projects?.map((project, index) => ({
      id: `project-${index + 1}`,
      name: project.name,
      startDate: project.startDate,
      endDate: project.endDate,
      current: project.current,
      description: project.description,
      employer: project.employer,
      url: project.url,
      skills: project.skills,
    })),
    achievements: parsed.achievements?.map((achievement, index) => ({
      id: `achievement-${index + 1}`,
      kind: achievement.kind,
      title: achievement.title,
      issuer: achievement.issuer,
      role: achievement.role,
      date: achievement.date,
      endDate: achievement.endDate,
      description: achievement.description,
      url: achievement.url,
    })),
    sourceSuggestions: parsed.openToWork
      ? {
          openToWork: {
            roles: parsed.openToWork.roles,
            locations: parsed.openToWork.locations,
            workplaceTypes: parsed.openToWork.workplaceTypes,
          },
        }
      : undefined,
  };
}

// eslint-disable-next-line max-lines-per-function
export function parsedResumeToFactDrafts(
  parsed: ParsedResume,
  sourceId: string = 'resume-pdf',
): ProfileFactDraft[] {
  const drafts: ProfileFactDraft[] = [];
  const now = new Date().toISOString();

  function makeFact(
    id: string,
    kind: ProfileFact['kind'],
    statement: string,
    locator: string,
  ): ProfileFactDraft {
    return {
      fact: {
        id,
        kind,
        statement,
        status: 'confirmed',
        confidence: 'source-reported',
        userEdited: false,
        provenance: {
          sourceId,
          platform: sourceId.includes('hh') ? 'hh' : 'other',
          accessPath: 'candidate_export',
          capturedAt: now,
          locator,
          rawSourceState: 'available',
        },
      },
      value: statement,
      decision: 'confirmed',
    };
  }

  if (parsed.targetRole) {
    drafts.push(makeFact('fact-role', 'headline', parsed.targetRole, 'resume:target_role'));
  }
  if (parsed.about) {
    drafts.push(makeFact('fact-about', 'summary', parsed.about, 'resume:about'));
  }
  if (parsed.contact.location) {
    drafts.push(makeFact('fact-loc', 'location', parsed.contact.location, 'resume:location'));
  }

  parsed.experience.forEach((exp, i) => {
    const period = exp.startDate
      ? `${exp.startDate} — ${exp.current ? 'наст. время' : exp.endDate ?? ''}`
      : '';
    drafts.push(
      makeFact(
        `fact-exp-${i + 1}`,
        'position',
        `${exp.title} в ${exp.employer}${period ? ` (${period})` : ''}`,
        `resume:experience:${i + 1}`,
      ),
    );
    exp.achievements.forEach((ach, j) => {
      drafts.push(
        makeFact(
          `fact-ach-${i + 1}-${j + 1}`,
          'summary',
          `Результат в ${exp.employer}: ${ach}`,
          `resume:experience:${i + 1}:achievement:${j + 1}`,
        ),
      );
    });
  });

  parsed.education.forEach((edu, i) => {
    drafts.push(
      makeFact(
        `fact-edu-${i + 1}`,
        'education',
        `${edu.institution}${edu.qualification ? `, ${edu.qualification}` : ''}${edu.endDate ? ` (${edu.endDate})` : ''}`,
        `resume:education:${i + 1}`,
      ),
    );
  });

  parsed.skills.slice(0, 15).forEach((skill, i) => {
    drafts.push(
      makeFact(`fact-skill-${i + 1}`, 'skill', skill, `resume:skill:${i + 1}`),
    );
  });

  return drafts;
}
