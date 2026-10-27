import React from 'react';
import {
  compactBuilderResume,
  contactLine,
  jobPeriod,
  type BuilderResume,
  type ResumeTemplate,
} from '../../../../shared/resumeBuilder/model';

interface ResumeSheetProps {
  readonly resume: BuilderResume;
  readonly template: ResumeTemplate;
  /** Clipped with a fade while it shows the sample, as on the mockup. */
  readonly clipped: boolean;
}

/** The on-page preview; the PDF and DOCX follow the same template rules on the server. */
// One block of markup; splitting it would scatter a single layout.
// eslint-disable-next-line max-lines-per-function
export function ResumeSheet({ resume: input, template, clipped }: ResumeSheetProps) {
  const resume = compactBuilderResume(input);
  const contacts = contactLine(resume);
  return (
    <div className={`sheet t-${template}${clipped ? '' : ' is-full'}`} aria-label="Превью резюме">
      <div className="hd">
        <div>
          <p className="nm">{resume.fullName || 'Имя Фамилия'}</p>
          {resume.title ? <div className="role">{resume.title}</div> : null}
          {contacts ? <div className="ct">{contacts}</div> : null}
        </div>
      </div>
      {resume.results.length ? (
        <div className="res">
          <p className="sec">Главные результаты</p>
          <ul>
            {resume.results.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {resume.jobs.length ? <p className="sec">Опыт работы</p> : null}
      {resume.jobs.map((job, index) => (
        <React.Fragment key={index}>
          <div className="job-h">
            <b>{job.company || job.role}</b>
            <span>{job.city}</span>
          </div>
          <div className="job-r">
            <i>{job.company ? job.role : ''}</i>
            <span>{jobPeriod(job)}</span>
          </div>
          {job.bullets.length ? (
            <ul>
              {job.bullets.map((item, bulletIndex) => (
                <li key={bulletIndex}>{item}</li>
              ))}
            </ul>
          ) : null}
        </React.Fragment>
      ))}
      {resume.education.length ? <p className="sec">Образование</p> : null}
      {resume.education.map((item, index) => (
        <React.Fragment key={index}>
          <div className="job-h">
            <b>{item.school}</b>
            <span>{item.year}</span>
          </div>
          {item.degree ? (
            <div className="job-r">
              <i>{item.degree}</i>
            </div>
          ) : null}
        </React.Fragment>
      ))}
      {resume.skills.trim() ? (
        <>
          <p className="sec">Навыки</p>
          <p>{resume.skills.trim()}</p>
        </>
      ) : null}
      {clipped ? <div className="fade" /> : null}
    </div>
  );
}
