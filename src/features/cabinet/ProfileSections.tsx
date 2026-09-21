import { Sparkle } from '@phosphor-icons/react';
import type { CandidateProfileView, ProfileExperienceEntry } from './profileView';

/**
 * Разделы профиля из макета «Пульт»: опыт карточками, навыки, образование и
 * «о себе». Всё показанное здесь пришло из разобранного резюме кандидата —
 * ни одного числа без своего знаменателя (B179).
 */

export function ProfileAbout({ view }: { view: CandidateProfileView }) {
  if (!view.about && view.languages.length === 0) {
    return <p className="career-profile-empty">Расскажите о себе — этот блок читают первым.</p>;
  }

  return (
    <section className="career-profile-block">
      {view.about ? (
        <>
          <h3>О себе</h3>
          <p className="career-profile-about">{view.about}</p>
        </>
      ) : null}
      {view.languages.length > 0 ? (
        <>
          <h3>Языки</h3>
          <ul className="career-profile-chips">
            {view.languages.map((language) => (
              <li key={language}>{language}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function ProfileExperience({
  view,
  onImprove,
}: {
  view: CandidateProfileView;
  onImprove: () => void;
}) {
  if (view.experience.length === 0) {
    return (
      <p className="career-profile-empty">
        Опыта пока нет. Загрузите резюме или подключите профиль на площадке — опыт появится здесь.
      </p>
    );
  }

  return (
    <section className="career-profile-block">
      <header className="career-profile-block-head">
        <h3>Опыт работы</h3>
        {view.totalExperience ? (
          <span className="career-cabinet-tag">{view.totalExperience}</span>
        ) : null}
      </header>
      <ol className="career-job-list">
        {view.experience.map((entry) => (
          <JobCard key={entry.id} entry={entry} onImprove={onImprove} />
        ))}
      </ol>
      {view.education.length === 0 ? (
        <p className="career-job-gap">
          Образование не заполнено — его спрашивает часть вакансий вашей выборки.
        </p>
      ) : null}
    </section>
  );
}

function JobCard({
  entry,
  onImprove,
}: {
  entry: ProfileExperienceEntry;
  onImprove: () => void;
}) {
  const measured = entry.measurableBullets;
  const total = entry.bullets.length;
  const quality = jobQuality(measured, total);

  return (
    <li className={`career-job-card is-${quality.tone}`}>
      <span className="career-job-signal" aria-hidden="true" />
      <div className="career-job-head">
        <span className="career-job-logo" aria-hidden="true">
          {employerInitials(entry.employer)}
        </span>
        <div className="career-job-title">
          <strong>
            {entry.title ?? 'Должность не названа'}
            {entry.employer ? ` · ${entry.employer}` : ''}
          </strong>
          <span className="career-job-period">
            {entry.period}
            {entry.duration ? ` · ${entry.duration}` : ''}
          </span>
        </div>
        <span className={`career-pill is-${quality.tone}`}>{quality.label}</span>
      </div>
      {total > 0 ? (
        <JobBullets entry={entry} onImprove={onImprove} />
      ) : (
        <p className="career-job-empty">
          В этом месте работы нет ни одного пункта — расскажите, что вы там сделали.
        </p>
      )}
    </li>
  );
}

function JobBullets({
  entry,
  onImprove,
}: {
  entry: ProfileExperienceEntry;
  onImprove: () => void;
}) {
  const total = entry.bullets.length;
  return (
    <>
      <ul className="career-job-bullets">
        {entry.bullets.map((bullet) => (
          <li key={bullet} className={carriesNumber(bullet) ? 'is-measured' : ''}>
            <span aria-hidden="true">▸</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      <div className="career-job-foot">
        <span className="career-cabinet-tag">
          {entry.measurableBullets} из {total} {bulletNoun(total)} с измеримым результатом
        </span>
        <button type="button" className="career-job-improve" onClick={onImprove}>
          <Sparkle size={14} weight="fill" /> Улучшить блок
        </button>
      </div>
    </>
  );
}

export function ProfileSkills({ view }: { view: CandidateProfileView }) {
  if (view.skills.length === 0) {
    return <p className="career-profile-empty">Навыки ещё не названы ни резюме, ни разговором.</p>;
  }

  return (
    <section className="career-profile-block">
      <header className="career-profile-block-head">
        <h3>Навыки</h3>
        <span className="career-cabinet-tag">{view.skills.length} из резюме</span>
      </header>
      <ul className="career-profile-chips">
        {view.skills.map((skill) => (
          <li key={skill}>{skill}</li>
        ))}
      </ul>
    </section>
  );
}

export function ProfileEducation({ view }: { view: CandidateProfileView }) {
  if (view.education.length === 0) {
    return <p className="career-profile-empty">Образование не заполнено.</p>;
  }

  return (
    <section className="career-profile-block">
      <header className="career-profile-block-head">
        <h3>Образование</h3>
        <span className="career-cabinet-tag">{view.education.length} из резюме</span>
      </header>
      <ol className="career-job-list">
        {view.education.map((entry) => (
          <li key={entry.id} className="career-job-card is-plain">
            <div className="career-job-head">
              <span className="career-job-logo" aria-hidden="true">
                {employerInitials(entry.institution)}
              </span>
              <div className="career-job-title">
                <strong>{entry.institution ?? 'Учебное заведение не названо'}</strong>
                <span className="career-job-period">
                  {[entry.qualification, entry.period].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const CARRIES_A_NUMBER = /\d/u;

function carriesNumber(text: string): boolean {
  return CARRIES_A_NUMBER.test(text);
}

/**
 * Ярлык блока — это пересказ счёта, а не оценка: «сильный блок» стоит там, где
 * величину называет большинство пунктов, и нигде больше.
 */
function jobQuality(measured: number, total: number): { tone: string; label: string } {
  if (total === 0) return { tone: 'muted', label: 'нет пунктов' };
  if (measured === 0) return { tone: 'warn', label: 'нет величин' };
  if (measured * 2 >= total) return { tone: 'good', label: 'сильный блок' };
  return { tone: 'warn', label: 'мало величин' };
}

function bulletNoun(count: number): string {
  const tail = count % 10;
  const teen = count % 100;
  if (teen >= 11 && teen <= 14) return 'пунктов';
  if (tail === 1) return 'пункта';
  if (tail >= 2 && tail <= 4) return 'пунктов';
  return 'пунктов';
}

function employerInitials(name?: string): string {
  if (!name) return '—';
  const words = name.split(/\s+/u).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toLocaleUpperCase('ru-RU') ?? '').join('') || '—';
}
