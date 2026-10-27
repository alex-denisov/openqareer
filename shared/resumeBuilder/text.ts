import { compactBuilderResume, contactLine, jobPeriod, type BuilderResume } from './model';

/**
 * Plain resume text in the section order of the strict template. It is what
 * the profile import reads (source «конструктор») and what the keyword check
 * searches, so both see exactly what the file shows.
 */
export function builderResumeText(input: BuilderResume): string {
  const resume = compactBuilderResume(input);
  const blocks: string[] = [];
  const head = [resume.fullName, resume.title, contactLine(resume)].filter(Boolean);
  if (head.length) blocks.push(head.join('\n'));
  if (resume.results.length) {
    blocks.push(['Главные результаты', ...resume.results.map((item) => `- ${item}`)].join('\n'));
  }
  if (resume.jobs.length) {
    const jobs = resume.jobs.map((job) =>
      [
        [job.role, job.company].filter(Boolean).join(', '),
        [job.city, jobPeriod(job)].filter(Boolean).join(' · '),
        ...job.bullets.map((item) => `- ${item}`),
      ]
        .filter(Boolean)
        .join('\n'),
    );
    blocks.push(['Опыт работы', ...jobs].join('\n\n'));
  }
  if (resume.education.length) {
    const rows = resume.education.map((item) =>
      [item.school, item.degree, item.year].filter(Boolean).join(', '),
    );
    blocks.push(['Образование', ...rows].join('\n'));
  }
  if (resume.skills.trim()) blocks.push(['Навыки', resume.skills.trim()].join('\n'));
  return blocks.join('\n\n');
}
