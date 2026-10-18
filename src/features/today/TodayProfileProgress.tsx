import { CalendarBlank, EnvelopeSimple, GraduationCap, Plus } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import { profileCompleteness } from '../resume/profileCompleteness';
import type { ResumeDraft } from '../resume/resumeTypes';
import type { TodayProfileFocus } from './todayApi';

/** Макет: полоса профиля в одну строку — три первых действия, остальные в «Профиле». */
const VISIBLE_PROFILE_ACTIONS = 3;

interface TodayProfileProgressAction {
  readonly label: string;
  readonly section: string;
  readonly focus: TodayProfileFocus;
}

function profileProgressActions(draft: ResumeDraft): readonly TodayProfileProgressAction[] {
  const completeness = profileCompleteness(draft);
  const incompleteDates = draft.experience.find(
    (entry) => !entry.startDate || (!entry.current && !entry.endDate),
  );
  return completeness.missingSections.map((section) => {
    if (section === 'Имя') return { label: 'Добавить имя', section, focus: { section: 'name' } };
    if (section === 'Контакты')
      return { label: 'Указать контакты', section, focus: { section: 'contacts' } };
    if (section === 'Опыт') {
      const dateField = incompleteDates
        ? !incompleteDates.startDate
          ? 'startDate'
          : 'endDate'
        : undefined;
      return {
        label: incompleteDates?.employer ? `Даты: ${incompleteDates.employer}` : 'Добавить опыт',
        section,
        focus: {
          section: 'experience',
          ...(incompleteDates
            ? {
                experienceId: incompleteDates.id,
                employer: incompleteDates.employer,
                title: incompleteDates.title,
                field: dateField,
              }
            : {}),
        },
      };
    }
    if (section === 'Образование')
      return { label: 'Добавить образование', section, focus: { section: 'education' } };
    if (section === 'Проекты')
      return { label: 'Добавить проекты', section, focus: { section: 'projects' } };
    if (section === 'Навыки')
      return { label: 'Добавить навыки', section, focus: { section: 'skills' } };
    if (section === 'Языки')
      return { label: 'Добавить языки', section, focus: { section: 'languages' } };
    if (section === 'Курсы')
      return { label: 'Добавить курсы', section, focus: { section: 'courses' } };
    if (section === 'Сертификаты')
      return { label: 'Добавить сертификаты', section, focus: { section: 'certifications' } };
    if (section === 'Рекомендации')
      return { label: 'Добавить рекомендации', section, focus: { section: 'recommendations' } };
    return { label: 'Добавить достижения', section, focus: { section: 'achievements' } };
  });
}

function ProfileActionIcon({ section }: { readonly section: string }) {
  if (section === 'Контакты') return <EnvelopeSimple size={16} aria-hidden="true" />;
  if (section === 'Опыт') return <CalendarBlank size={16} aria-hidden="true" />;
  if (section === 'Курсы') return <GraduationCap size={16} aria-hidden="true" />;
  return <Plus size={16} aria-hidden="true" />;
}

export function TodayProfileProgress({
  draft,
  onNavigate,
  onNavigateProfileTarget,
}: {
  readonly draft: ResumeDraft;
  readonly onNavigate?: (view: CareerCabinetView) => void;
  readonly onNavigateProfileTarget?: (target: TodayProfileFocus) => void;
}) {
  const completeness = profileCompleteness(draft);
  if (!completeness.missingSections.length) return null;
  const actions = profileProgressActions(draft);
  const percent = Math.round((completeness.completedCount / completeness.totalCount) * 100);
  return (
    <section className="career-today-profile-progress" aria-label="Полнота профиля">
      <div className="career-today-profile-progress-main">
        <p>
          Профиль готов на <strong>{percent} %</strong>:{' '}
          {pluralRu(actions.length, ['действие', 'действия', 'действий'])}
        </p>
        <progress
          className="career-today-profile-meter"
          max={completeness.totalCount}
          value={completeness.completedCount}
          aria-label={`Профиль готов на ${percent} процентов`}
        />
      </div>
      <div className="career-today-profile-actions" aria-label="Что заполнить">
        {actions.slice(0, VISIBLE_PROFILE_ACTIONS).map((action) => (
          <button
            key={action.section}
            type="button"
            className="career-btn career-btn-secondary career-btn-sm career-today-profile-action"
            onClick={() =>
              onNavigateProfileTarget
                ? onNavigateProfileTarget(action.focus)
                : onNavigate?.('profile')
            }
            disabled={!onNavigateProfileTarget && !onNavigate}
          >
            <ProfileActionIcon section={action.section} />
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
