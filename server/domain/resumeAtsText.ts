import { EMPTY_RESUME_DRAFT, type ResumeCourseInput, type ResumeDraft, type ResumeLanguageInput } from './resumeDraft';
import type {
  ResumeDocument,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  TargetedResumeSlice,
} from './resumeStudioTypes';

export function formatResumeAsAtsText(doc: ResumeDocument, draft: ResumeDraft): string {
  const sections: string[] = [];
  const header = formatAtsHeader(doc, draft);
  if (header) sections.push(header);

  const about = (doc.about ?? draft.candidate.about ?? '').trim();
  if (about) sections.push('=== SUMMARY ===\n' + about);

  const experienceBlocks = formatAtsExperience(doc.experience);
  if (experienceBlocks) sections.push('=== WORK EXPERIENCE ===\n\n' + experienceBlocks);

  const skillsList = (doc.skills ?? draft.skills ?? [])
    .map((skill) => skill.name?.trim())
    .filter((skill): skill is string => Boolean(skill));
  if (skillsList.length > 0) sections.push('=== SKILLS ===\n' + skillsList.join(', '));

  const educationBlocks = formatAtsEducation(doc.education);
  if (educationBlocks) sections.push('=== EDUCATION ===\n\n' + educationBlocks);

  const languages = formatAtsLanguages(doc, draft);
  if (languages) sections.push(languages);

  const courses = formatAtsCourses(doc, draft);
  if (courses) sections.push(courses);

  const projects = formatAtsProjects(doc.projects ?? []);
  if (projects) sections.push(projects);

  return sections.join('\n\n');
}

export function formatTargetedResumeAsAtsText(slice: TargetedResumeSlice): string {
  const sections = [formatResumeAsAtsText(slice.document, EMPTY_RESUME_DRAFT)];
  if (slice.missingRequirements.length > 0) {
    const gaps = slice.missingRequirements
      .map((requirement) => '- ' + requirement + ' - не найдено в мастер-резюме')
      .join('\n');
    sections.push('=== REQUIREMENT GAPS ===\n' + gaps);
  }
  return sections.filter(Boolean).join('\n\n');
}

function formatAtsHeader(doc: ResumeDocument, draft: ResumeDraft): string | null {
  const fullName = (doc.contact.fullName ?? draft.candidate.fullName ?? '').trim();
  const targetRole = (doc.targetRole ?? draft.targetRole ?? '').trim();
  const contactParts = [
    doc.contact.location ?? draft.candidate.contact?.location,
    doc.contact.phone ?? draft.candidate.contact?.phone,
    doc.contact.email ?? draft.candidate.contact?.email,
    draft.candidate.contact?.telegram,
    doc.contact.links?.[0] ?? draft.candidate.contact?.links?.[0],
  ]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  const headerLines: string[] = [];
  if (fullName) headerLines.push(fullName.toUpperCase());
  if (targetRole) headerLines.push(targetRole);
  if (contactParts.length > 0) headerLines.push(contactParts.join(' | '));
  return headerLines.length > 0 ? headerLines.join('\n') : null;
}

function formatAtsLanguages(doc: ResumeDocument, draft: ResumeDraft): string | null {
  const languagesList = (doc.languages.length > 0 ? doc.languages : (draft.languages ?? []))
    .map((language) => {
      const name =
        'name' in language && typeof language.name === 'object' && language.name !== null
          ? language.name.value
          : (language as ResumeLanguageInput).name;
      const cefr =
        'cefr' in language && typeof language.cefr === 'object' && language.cefr !== null
          ? language.cefr.value
          : (language as ResumeLanguageInput).cefr;
      const hasNativeProficiency = 'native' in language && language.native?.value === 'native';
      const trimmedName = name?.trim();
      if (!trimmedName) return '';
      if (cefr) return trimmedName + ' (' + cefr + ')';
      return hasNativeProficiency ? trimmedName + ' (родной)' : trimmedName;
    })
    .filter(Boolean);

  return languagesList.length > 0 ? '=== LANGUAGES ===\n' + languagesList.join(', ') : null;
}

function formatAtsCourses(doc: ResumeDocument, draft: ResumeDraft): string | null {
  const coursesList = (doc.courses ?? draft.courses ?? [])
    .map((course: ResumeCourseInput) => {
      const parts = [
        course.name?.trim(),
        (course.provider ?? course.institution)?.trim(),
        course.year ? String(course.year) : '',
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);

  return coursesList.length > 0
    ? '=== COURSES AND CERTIFICATIONS ===\n' + coursesList.join('\n')
    : null;
}

function formatAtsProjects(projects: readonly ResumeProject[]): string | null {
  const blocks = projects
    .map((project) => {
      const name = project.name.value.trim();
      const employer = project.employer?.value.trim();
      const heading = [name, employer].filter(Boolean).join(' | ');
      const start = project.startDate?.value.trim();
      const end = project.current?.value ? 'настоящее время' : project.endDate?.value.trim();
      const period = start && end ? start + ' — ' + end : (start ?? end ?? '');
      const description = project.description?.value.trim();
      const skills = project.skills
        .map((skill) => skill.value.trim())
        .filter(Boolean)
        .join(', ');
      return [heading, period, description, skills ? 'Навыки проекта: ' + skills : '']
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean);
  return blocks.length > 0
    ? '=== PROJECTS ===\n\n' + blocks.join('\n\n')
    : null;
}

function formatAtsExperience(experiences: readonly ResumeExperience[]): string {
  if (!experiences.length) return '';
  return experiences
    .map((experience) => {
      const title = experience.title?.value?.trim() ?? '';
      const employer = experience.employer?.value?.trim() ?? '';
      const location = experience.location?.value?.trim() ?? '';
      const headerLine = [title, employer, location].filter(Boolean).join(' | ');

      const start = experience.startDate?.value?.trim();
      const isCurrent = experience.current?.value;
      const end = isCurrent ? 'Present' : experience.endDate?.value?.trim();
      const periodLine = start && end ? start + ' - ' + end : (start ?? end ?? '');

      const description = experience.description?.value.trim();
      const bullets = experience.bullets
        .map((bullet) => bullet.value?.trim())
        .filter(Boolean)
        .map((bullet) => '- ' + bullet);

      return [headerLine, periodLine, description, ...bullets].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function formatAtsEducation(education: readonly ResumeEducation[]): string {
  if (!education.length) return '';
  return education
    .map((item) => {
      const institution = item.institution?.value?.trim();
      const qualification = item.qualification?.value?.trim();
      const start = item.startDate?.value?.trim();
      const end = item.endDate?.value?.trim();
      const period = start && end ? start + ' - ' + end : (start ?? end ?? '');

      return [institution, qualification, period].filter(Boolean).join(' | ');
    })
    .filter(Boolean)
    .join('\n');
}
