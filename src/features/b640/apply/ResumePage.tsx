import { Fragment } from 'react';
import {
  compactBuilderResume,
  contactParts,
  jobPeriod,
  resumeHeadings,
  tailSections,
  type BuilderJob,
  type BuilderResume,
  type ResumeTemplate,
} from '../../../../shared/resumeBuilder/model';

/** С этого числа строк страница заполнена, и макет распределяет их по её высоте. */
const FULL_PAGE_LINES = 20;

const linesIn = (resume: BuilderResume) =>
  resume.jobs.reduce((total, job) => total + 2 + job.bullets.length, 0) +
  resume.education.length * 2;

function Head({
  resume,
  template,
}: {
  readonly resume: BuilderResume;
  readonly template: ResumeTemplate;
}) {
  const contacts = contactParts(resume);
  return (
    <div className="cv-head">
      <div className="cv-name">{resume.fullName}</div>
      {template !== 'strict' && resume.title ? (
        <div className="cv-title">{resume.title}</div>
      ) : null}
      {contacts.length ? (
        <div className="cv-contacts">
          {contacts.map((item, index) => (
            <Fragment key={item}>
              {index > 0 ? ' · ' : null}
              <span className="cv-ct">{item}</span>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Job({ job, lang }: { readonly job: BuilderJob; readonly lang: BuilderResume['lang'] }) {
  const role = job.company ? job.role : '';
  const period = jobPeriod(job, lang);
  return (
    <div className="cv-job">
      <div className="cv-split">
        <b>{job.company || job.role}</b>
        {job.city ? <span>{job.city}</span> : null}
      </div>
      {role || period ? (
        <div className="cv-split cv-role">
          <i>{role}</i>
          {period ? <span>{period}</span> : null}
        </div>
      ) : null}
      {job.bullets.length ? (
        <ul>
          {job.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Education({ resume }: { readonly resume: BuilderResume }) {
  if (resume.education.length === 0) return null;
  return (
    <>
      <h4 className="cv-h">{resumeHeadings(resume).education}</h4>
      {resume.education.map((item, index) => (
        <Fragment key={`${index}-${item.school}`}>
          <div className="cv-split">
            <b>{item.school || item.degree}</b>
            {item.year ? <span>{item.year}</span> : null}
          </div>
          {item.school && item.degree ? (
            <div className="cv-split cv-role">
              <i>{item.degree}</i>
            </div>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

interface Props {
  readonly resume: BuilderResume;
  readonly template: ResumeTemplate;
}

/** Лист A4 макета o03: те же разделы и порядок, что в файлах PDF и DOCX. */
export function ResumePage({ resume: input, template }: Props) {
  const resume = compactBuilderResume(input);
  const titles = resumeHeadings(resume);
  const page = linesIn(resume) >= FULL_PAGE_LINES ? 'cv-page cv-fill' : 'cv-page';
  return (
    <div className="cv-stage">
      <article lang={resume.lang} className={`cv-sheet cv-doc cv-${template}`} aria-label="Резюме">
        <section className={page} aria-label="Страница резюме">
          <Head resume={resume} template={template} />
          {resume.about?.trim() ? (
            <>
              <h4 className="cv-h">{titles.about}</h4>
              <p>{resume.about}</p>
            </>
          ) : null}
          {resume.jobs.length ? <h4 className="cv-h">{titles.jobs}</h4> : null}
          {resume.jobs.map((job, index) => (
            <Job key={`${index}-${job.company}`} job={job} lang={resume.lang} />
          ))}
          <Education resume={resume} />
          {tailSections(resume).map((item) => (
            <Fragment key={item.title}>
              <h4 className="cv-h">{item.title}</h4>
              {item.lines.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </Fragment>
          ))}
        </section>
      </article>
    </div>
  );
}
