import { useState, useMemo, useEffect } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import type { ResumeDocument, ResumeDraft, ResumeExperience } from './resumeTypes';

export interface ResumeLinkedInPackViewProps {
  readonly document: ResumeDocument;
  readonly draft: ResumeDraft;
}

const HEADLINE_MAX = 220;
const ABOUT_MAX = 2600;

async function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  } catch {
    // Ignore in tests / unsupported clipboard
  }
}

function buildDefaultHeadline(draft: ResumeDraft, document: ResumeDocument): string {
  const role = (draft.targetRole ?? document.targetRole ?? '').trim();
  const topSkills = (draft.skills ?? document.skills ?? [])
    .slice(0, 4)
    .map((s) => s.name.trim())
    .filter(Boolean);
  const lastEmployer = document.experience[0]?.employer?.value ?? draft.experience[0]?.employer;

  const parts = [role];
  if (topSkills.length > 0) parts.push(topSkills.join(' | '));
  const current = document.experience[0]?.current?.value ?? draft.experience[0]?.current;
  if (lastEmployer && current === false) parts.push('Ex-' + lastEmployer);
  const full = parts.join(' | ');
  return full.length > HEADLINE_MAX ? full.slice(0, HEADLINE_MAX) : full;
}

function LinkedInHeadlineCard({
  draft,
  document,
}: {
  readonly draft: ResumeDraft;
  readonly document: ResumeDocument;
}) {
  const defaultHeadline = useMemo(() => buildDefaultHeadline(draft, document), [draft, document]);
  const [headline, setHeadline] = useState(defaultHeadline);
  const [copied, setCopied] = useState(false);
  useEffect(() => setHeadline(defaultHeadline), [defaultHeadline]);

  return (
    <section className="career-resume-linkedin-card">
      <div className="career-resume-linkedin-card-head">
        <div className="career-resume-linkedin-title-wrap">
          <h4>Заголовок профиля (Headline)</h4>
          <span
            className={`career-resume-char-counter ${
              headline.length > HEADLINE_MAX ? 'is-overflow' : ''
            }`}
          >
            {headline.length} / {HEADLINE_MAX}
          </span>
        </div>
        <button
          type="button"
          className="career-button is-compact"
          onClick={() => copyToClipboard(headline, setCopied)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Скопировано!' : 'Копировать заголовок'}
        </button>
      </div>
      <p className="career-resume-linkedin-desc">
        Отображается под именем в поиске, ленте и комментариях. Включает целевую роль, специализацию и доказательства.
      </p>
      <textarea
        className="career-resume-linkedin-textarea is-headline"
        rows={2}
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        placeholder="Целевая роль | Ключевые компетенции | Достижения"
      />
    </section>
  );
}

function LinkedInAboutCard({
  draft,
  document,
}: {
  readonly draft: ResumeDraft;
  readonly document: ResumeDocument;
}) {
  const defaultAbout = useMemo(
    () => (draft.candidate.about ?? document.about ?? '').trim(),
    [draft.candidate.about, document.about],
  );
  const [about, setAbout] = useState(defaultAbout);
  const [copied, setCopied] = useState(false);
  useEffect(() => setAbout(defaultAbout), [defaultAbout]);

  return (
    <section className="career-resume-linkedin-card">
      <div className="career-resume-linkedin-card-head">
        <div className="career-resume-linkedin-title-wrap">
          <h4>О себе (About)</h4>
          <span
            className={`career-resume-char-counter ${
              about.length > ABOUT_MAX ? 'is-overflow' : ''
            }`}
          >
            {about.length} / {ABOUT_MAX}
          </span>
        </div>
        <button
          type="button"
          className="career-button is-compact"
          onClick={() => copyToClipboard(about, setCopied)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Скопировано!' : 'Копировать About'}
        </button>
      </div>
      <p className="career-resume-linkedin-desc">
        Текст от первого лица: профессиональное позиционирование, сильные стороны и измеримые победы.
      </p>
      <textarea
        className="career-resume-linkedin-textarea is-about"
        rows={7}
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        placeholder="Расскажите о своем опыте, результатах и фокусе..."
      />
    </section>
  );
}

function LinkedInExperienceRoleItem({ exp }: { readonly exp: ResumeExperience }) {
  const title = exp.title?.value ?? 'Роль';
  const employer = exp.employer?.value ?? 'Компания';
  const start = exp.startDate?.value ?? '';
  const end = exp.current?.value ? 'Present' : exp.endDate?.value ?? '';
  const period = start && end ? `${start} – ${end}` : start || end;

  return (
    <article className="career-resume-linkedin-role">
      <header className="career-resume-linkedin-role-header">
        <h5>{title}</h5>
        <span className="career-resume-linkedin-employer">{employer}</span>
        {period ? <span className="career-resume-linkedin-period">{period}</span> : null}
      </header>
      <ul className="career-resume-linkedin-bullets">
        {exp.bullets.map((b, i) => (
          <li key={i}>{b.value}</li>
        ))}
      </ul>
    </article>
  );
}

function LinkedInExperienceCard({
  experience,
}: {
  readonly experience: readonly ResumeExperience[];
}) {
  const [copied, setCopied] = useState(false);
  const experienceText = useMemo(() => formatLinkedInExperience(experience), [experience]);

  return (
    <section className="career-resume-linkedin-card">
      <div className="career-resume-linkedin-card-head">
        <div className="career-resume-linkedin-title-wrap">
          <h4>Опыт работы для LinkedIn</h4>
          <span className="career-resume-card-kicker">{experience.length} ролей</span>
        </div>
        <button
          type="button"
          className="career-button is-compact"
          onClick={() => copyToClipboard(experienceText, setCopied)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Скопировано!' : 'Копировать опыт'}
        </button>
      </div>
      <p className="career-resume-linkedin-desc">
        Буллеты, разбитые на легко читаемые короткие абзацы для комфортного чтения со смартфона.
      </p>
      <div className="career-resume-linkedin-experience-preview">
        {experience.length === 0 ? (
          <p className="career-resume-empty">Роли ещё не добавлены в резюме.</p>
        ) : (
          experience.map((exp) => <LinkedInExperienceRoleItem key={exp.id} exp={exp} />)
        )}
      </div>
    </section>
  );
}

function LinkedInSkillsCard({
  skills,
}: {
  readonly skills: readonly { readonly name: string }[];
}) {
  const [copied, setCopied] = useState(false);
  const skillsList = useMemo(() => {
    const rawSkills = skills.map((s) => s.name.trim()).filter(Boolean);
    return Array.from(new Set(rawSkills)).slice(0, 50);
  }, [skills]);

  return (
    <section className="career-resume-linkedin-card">
      <div className="career-resume-linkedin-card-head">
        <div className="career-resume-linkedin-title-wrap">
          <h4>Навыки для поиска (Top Skills)</h4>
          <span className="career-resume-card-kicker">{skillsList.length} / 50 навыков</span>
        </div>
        <button
          type="button"
          className="career-button is-compact"
          onClick={() => copyToClipboard(skillsList.join(', '), setCopied)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Скопировано!' : 'Копировать навыки'}
        </button>
      </div>
      <p className="career-resume-linkedin-desc">
        Ключевые слова, по которым рекрутеры находят ваш профиль через LinkedIn Recruiter.
      </p>
      {skillsList.length === 0 ? (
        <p className="career-resume-empty">Навыки не указаны.</p>
      ) : (
        <div className="career-resume-linkedin-skills">
          {skillsList.map((skill, index) => (
            <span key={index} className="career-chip">
              {skill}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function ResumeLinkedInPackView({ document, draft }: ResumeLinkedInPackViewProps) {
  return (
    <div className="career-resume-linkedin-pack" aria-label="Комплект для позиционирования в LinkedIn">
      <div className="career-resume-linkedin-head">
        <div>
          <h3>Профиль LinkedIn</h3>
          <p>
            Готовые блоки для оформления сильного профиля: оптимизированы под мобильное чтение и поисковые алгоритмы рекрутеров.
          </p>
        </div>
      </div>

      <div className="career-resume-linkedin-grid">
        <LinkedInHeadlineCard draft={draft} document={document} />
        <LinkedInAboutCard draft={draft} document={document} />
        <LinkedInExperienceCard experience={document.experience} />
        <LinkedInSkillsCard skills={draft.skills ?? document.skills ?? []} />
      </div>
    </div>
  );
}

function formatLinkedInExperience(experiences: readonly ResumeExperience[]): string {
  if (!experiences.length) return '';
  return experiences
    .map((exp) => {
      const title = exp.title?.value?.trim() ?? '';
      const employer = exp.employer?.value?.trim() ?? '';
      const start = exp.startDate?.value?.trim() ?? '';
      const isCurrent = exp.current?.value;
      const end = isCurrent ? 'Present' : exp.endDate?.value?.trim() ?? '';
      const period = start && end ? `${start} – ${end}` : (start || end);

      const header = [title, employer, period].filter(Boolean).join(' | ');
      const bullets = exp.bullets
        .map((b) => b.value?.trim())
        .filter(Boolean)
        .map((b) => `• ${b}`);

      return [header, ...bullets].join('\n');
    })
    .join('\n\n');
}
