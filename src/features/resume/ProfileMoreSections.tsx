import { BookOpen, Quotes } from '@phosphor-icons/react';
import type { ResumeAchievementInput, ResumeDraft } from './resumeTypes';

function SectionHead({
  id,
  title,
  count,
  imported,
  emptyTag,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: string;
  readonly imported?: boolean;
  readonly emptyTag?: boolean;
}) {
  return (
    <div className="career-profile-section-head">
      <h2 id={id}>{title}</h2>
      {count ? <span className="career-profile-section-count">{count}</span> : null}
      {imported ? <span className="career-cabinet-tag is-accent">Импортировано</span> : null}
      {emptyTag ? <span className="career-cabinet-tag">Пусто</span> : null}
    </div>
  );
}

export function ProfileCertificatesSection({ draft }: { readonly draft: ResumeDraft }) {
  const certifications = draft.certifications ?? [];
  if (!certifications.length) return null;
  return (
    <section className="career-profile-panel career-profile-section" id="sec-certificates" aria-labelledby="sec-certificates-title">
      <SectionHead id="sec-certificates-title" title="Сертификаты" count={String(certifications.length)} imported />
      <div className="career-profile-tile-grid">
        {certifications.map((cert) => (
          <div key={cert.id} className="career-profile-tile">
            <b>{cert.name}</b>
            <span className="career-profile-tile-meta">
              {[cert.issuer, cert.issuedAt ? `выдан ${cert.issuedAt}` : undefined]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {cert.url ? (
              <a className="career-profile-tile-link" href={cert.url}>
                Подтверждение
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProfileProjectsSection({ draft }: { readonly draft: ResumeDraft }) {
  const projects = draft.projects ?? [];
  if (!projects.length) return null;
  return (
    <section className="career-profile-panel career-profile-section" id="sec-projects" aria-labelledby="sec-projects-title">
      <SectionHead id="sec-projects-title" title="Проекты" count={String(projects.length)} imported />
      <div className="career-profile-tile-grid">
        {projects.map((project) => (
          <div key={project.id} className="career-profile-tile">
            <b>{project.name}</b>
            <span className="career-profile-tile-meta">
              {[project.employer, [project.startDate, project.endDate].filter(Boolean).join(' — ')]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {project.description ? <p>{project.description}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Courses stay honest about a source that never had them (B265 §4: "честное
 * «пусто в источнике»") — the section still renders, saying so plainly,
 * instead of vanishing the way the other optional sections do.
 */
export function ProfileCoursesSection({
  draft,
  importedLabel,
}: {
  readonly draft: ResumeDraft;
  readonly importedLabel?: string;
}) {
  const courses = draft.courses ?? [];
  if (!courses.length) {
    return (
      <section className="career-profile-panel career-profile-section" id="sec-courses" aria-labelledby="sec-courses-title">
        <SectionHead id="sec-courses-title" title="Курсы" emptyTag />
        <div className="career-profile-state-block">
          <BookOpen size={22} />
          <h3>
            {importedLabel ? `${importedLabel} не передал курсы для этого профиля` : 'Курсы не заполнены'}
          </h3>
          <p>Раздел действительно пуст в источнике — это не ошибка импорта. Добавьте курсы вручную, если они у вас есть.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="career-profile-panel career-profile-section" id="sec-courses" aria-labelledby="sec-courses-title">
      <SectionHead id="sec-courses-title" title="Курсы" count={String(courses.length)} imported />
      <div className="career-profile-tile-grid">
        {courses.map((course) => (
          <div key={course.id} className="career-profile-tile">
            <b>{course.name}</b>
            <span className="career-profile-tile-meta">
              {[course.institution ?? course.provider, course.year ? String(course.year) : undefined]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProfileLanguagesSection({ draft }: { readonly draft: ResumeDraft }) {
  if (!draft.languages.length) return null;
  return (
    <section className="career-profile-panel career-profile-section" id="sec-languages" aria-labelledby="sec-languages-title">
      <SectionHead id="sec-languages-title" title="Языки" count={String(draft.languages.length)} imported />
      {draft.languages.map((lang) => (
        <div key={lang.id} className="career-profile-lang-row">
          <div className="career-profile-lang-name">{lang.name || 'Язык не указан'}</div>
          {lang.cefr ? <span className="career-profile-cefr">{lang.cefr}</span> : null}
        </div>
      ))}
    </section>
  );
}

export function ProfileRecommendationsSection({ draft }: { readonly draft: ResumeDraft }) {
  const recommendations = draft.recommendations ?? [];
  if (!recommendations.length) {
    return (
      <section className="career-profile-panel career-profile-section" id="sec-recommendations" aria-labelledby="sec-recommendations-title">
        <SectionHead id="sec-recommendations-title" title="Рекомендации" />
        <p className="career-profile-empty-note">Рекомендаций пока нет.</p>
      </section>
    );
  }
  return (
    <section className="career-profile-panel career-profile-section" id="sec-recommendations" aria-labelledby="sec-recommendations-title">
      <SectionHead id="sec-recommendations-title" title="Рекомендации" count={String(recommendations.length)} imported />
      {recommendations.map((rec) => (
        <div key={rec.id} className="career-profile-rec">
          <p className="career-profile-rec-quote">
            <Quotes size={14} />
            {rec.text}
          </p>
          <div className="career-profile-rec-author">
            <b>{rec.recommender || rec.author}</b>
            <span>{[rec.position ?? rec.role, rec.organization].filter(Boolean).join(', ')}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

const ACHIEVEMENT_GROUP_LABEL: Record<ResumeAchievementInput['kind'], string> = {
  honor: 'Награды',
  publication: 'Публикации',
  patent: 'Патенты',
  organization: 'Организации',
  volunteering: 'Волонтёрство',
};

export function ProfileAchievementsSection({ draft }: { readonly draft: ResumeDraft }) {
  const achievements = draft.achievements ?? [];
  if (!achievements.length) return null;
  const groups = new Map<ResumeAchievementInput['kind'], ResumeAchievementInput[]>();
  achievements.forEach((achievement) => {
    const bucket = groups.get(achievement.kind) ?? [];
    groups.set(achievement.kind, [...bucket, achievement]);
  });
  return (
    <section className="career-profile-panel career-profile-section" id="sec-achievements" aria-labelledby="sec-achievements-title">
      <SectionHead id="sec-achievements-title" title="Достижения" imported />
      {[...groups.entries()].map(([kind, items]) => (
        <div key={kind} className="career-profile-achv-group">
          <h3>{ACHIEVEMENT_GROUP_LABEL[kind]}</h3>
          {items.map((item) => (
            <div key={item.id} className="career-profile-achv-item">
              <b>{item.title}</b>
              <span>{[item.issuer, item.date].filter(Boolean).join(' · ')}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
