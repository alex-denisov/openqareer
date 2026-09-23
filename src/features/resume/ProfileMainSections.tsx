import { Buildings } from '@phosphor-icons/react';
import { categorizeSkills, groupExperienceByEmployer } from './profileGrouping';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';

function SectionHead({
  id,
  title,
  count,
  imported,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: string;
  readonly imported?: boolean;
}) {
  return (
    <div className="career-profile-section-head">
      <h2 id={id}>{title}</h2>
      {count ? <span className="career-profile-section-count">{count}</span> : null}
      {imported ? <span className="career-cabinet-tag is-accent">Импортировано</span> : null}
    </div>
  );
}

export function ProfileAboutSection({ draft }: { readonly draft: ResumeDraft }) {
  const about = draft.candidate.about?.trim();
  if (!about) return null;
  const paragraphs = about.split(/\n{2,}/u).filter(Boolean);
  return (
    <section className="career-profile-panel career-profile-section" id="sec-about" aria-labelledby="sec-about-title">
      <SectionHead id="sec-about-title" title="Обо мне" imported />
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </section>
  );
}

function periodLabel(entry: ResumeExperienceInput): string {
  if (!entry.startDate) return '';
  const end = entry.current ? 'по настоящее время' : entry.endDate ?? '';
  return end ? `${entry.startDate} — ${end}` : entry.startDate;
}

function PositionRow({ entry }: { readonly entry: ResumeExperienceInput }) {
  return (
    <div className="career-profile-position">
      <div className="career-profile-position-title-row">
        <b>{entry.title || 'Должность не указана'}</b>
      </div>
      <div className="career-profile-position-tags">
        {entry.employmentType ? <span className="career-cabinet-tag">{entry.employmentType}</span> : null}
        {entry.workplaceType ? (
          <span className="career-cabinet-tag">{WORKPLACE_LABEL[entry.workplaceType]}</span>
        ) : null}
      </div>
      {periodLabel(entry) ? <div className="career-profile-position-dates">{periodLabel(entry)}</div> : null}
      {entry.skills?.length ? (
        <div className="career-profile-skill-row">
          {entry.skills.map((skill) => (
            <span key={skill} className="career-cabinet-tag">
              {skill}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const WORKPLACE_LABEL: Record<string, string> = {
  on_site: 'On-site',
  hybrid: 'Гибрид',
  remote: 'Remote',
};

export function ProfileExperienceSection({ draft }: { readonly draft: ResumeDraft }) {
  if (!draft.experience.length) {
    return (
      <section className="career-profile-panel career-profile-section" id="sec-experience" aria-labelledby="sec-experience-title">
        <SectionHead id="sec-experience-title" title="Опыт" />
        <p className="career-profile-empty-note">Опыт работы ещё не добавлен.</p>
      </section>
    );
  }
  const groups = groupExperienceByEmployer(draft.experience);
  return (
    <section className="career-profile-panel career-profile-section" id="sec-experience" aria-labelledby="sec-experience-title">
      <SectionHead
        id="sec-experience-title"
        title="Опыт"
        count={`${draft.experience.length} позиции · ${groups.length} компании`}
        imported
      />
      {groups.map((group) => (
        <div key={group.key} className="career-profile-company-group">
          <div className="career-profile-company-head">
            <span className="career-profile-company-logo" aria-hidden="true">
              <Buildings size={20} />
            </span>
            <div>
              <b>{group.employer || 'Работодатель не указан'}</b>
              {group.location ? <div className="career-profile-company-span">{group.location}</div> : null}
            </div>
          </div>
          {group.positions.map((entry) => (
            <PositionRow key={entry.id} entry={entry} />
          ))}
        </div>
      ))}
    </section>
  );
}

export function ProfileEducationSection({ draft }: { readonly draft: ResumeDraft }) {
  if (!draft.education.length) {
    return (
      <section className="career-profile-panel career-profile-section" id="sec-education" aria-labelledby="sec-education-title">
        <SectionHead id="sec-education-title" title="Образование" />
        <p className="career-profile-empty-note">Образование ещё не добавлено.</p>
      </section>
    );
  }
  return (
    <section className="career-profile-panel career-profile-section" id="sec-education" aria-labelledby="sec-education-title">
      <SectionHead id="sec-education-title" title="Образование" count={String(draft.education.length)} imported />
      {draft.education.map((edu) => (
        <div key={edu.id} className="career-profile-edu-item">
          <b>{edu.institution || 'Учебное заведение не указано'}</b>
          <div className="career-profile-edu-meta">
            {[edu.qualification, [edu.startDate, edu.endDate].filter(Boolean).join(' — ')]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {edu.description ? <p>{edu.description}</p> : null}
        </div>
      ))}
    </section>
  );
}

export function ProfileSkillsSection({ draft }: { readonly draft: ResumeDraft }) {
  const skills = draft.skills ?? [];
  if (!skills.length) {
    return (
      <section className="career-profile-panel career-profile-section" id="sec-skills" aria-labelledby="sec-skills-title">
        <SectionHead id="sec-skills-title" title="Навыки" />
        <p className="career-profile-empty-note">Навыки ещё не добавлены.</p>
      </section>
    );
  }
  const groups = categorizeSkills(skills);
  return (
    <section className="career-profile-panel career-profile-section" id="sec-skills" aria-labelledby="sec-skills-title">
      <SectionHead id="sec-skills-title" title="Навыки" count={String(skills.length)} imported />
      <div className="career-profile-skill-groups">
        {groups.map((group) => (
          <div key={group.label}>
            <span className="career-profile-group-label">{group.label}</span>
            <div className="career-profile-group-chips">
              {group.skills.map((skill) => (
                <span key={skill.id} className="career-cabinet-tag">
                  {skill.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
