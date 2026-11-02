import { Clock, ListChecks, Plus, Star, UsersThree } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { InterviewQuestionView } from './interviewSimulatorApi';
import { formatSourceDate } from './interviewSimulatorPresentation';
import type { MockInterviewVacancy } from './mockInterviewSimulatorTypes';
import type { StarStoriesSnapshot } from '../../../shared/starStories';

const REQUIREMENTS_SHOWN = 3;

interface SourcePanelProps {
  readonly vacancy: MockInterviewVacancy;
  readonly stories?: StarStoriesSnapshot | null;
  readonly storiesError?: string | null;
  readonly question?: InterviewQuestionView | null;
  readonly onOpenStories: () => void;
}

/** «На чём строятся вопросы»: требования вакансии, STAR-истории, интервьюеры и источник (макет 14). */
export function SourcePanel({ vacancy, stories, storiesError, question, onOpenStories }: SourcePanelProps) {
  const active = question?.type === 'behavioral' ? 'star' : 'requirements';
  const storyCount = stories?.stories.length ?? 0;
  return (
    <aside className="career-mock-source-panel" aria-labelledby="career-mock-sources-title">
      <h2 id="career-mock-sources-title">На чём строятся вопросы</h2>
      <ul className="career-mock-source-list">
        <SourceItem icon={<ListChecks aria-hidden="true" />} title="Требования вакансии" active={active === 'requirements'}>
          {requirementsDetail(vacancy)}
        </SourceItem>
        <SourceItem icon={<Star aria-hidden="true" />} title={`Ваши STAR-истории: ${storyCount}`} active={active === 'star'}>
          {storiesError ?? storiesDetail(stories)}
        </SourceItem>
        <SourceItem icon={<UsersThree aria-hidden="true" />} title="Интервьюеры" active={false}>
          Профили не подтверждены: в вопросах не используются
        </SourceItem>
      </ul>
      {stories && storyCount === 0 ? (
        <div className="career-mock-empty-note" role="status">
          Историй в профиле нет: вопросы будут только по требованиям вакансии. Добавьте историю, и появятся поведенческие.
          <button type="button" className="career-btn career-btn-secondary" onClick={onOpenStories}>
            <Plus aria-hidden="true" className="career-mock-icon" />
            Добавить историю
          </button>
        </div>
      ) : null}
      <p className="career-mock-source-origin">
        <Clock aria-hidden="true" className="career-mock-icon" />
        <span>{sourceLine(vacancy)}</span>
      </p>
      <p className="career-mock-source-disclaimer">
        Оценка делается моделью по критериям и может ошибаться. Это тренировка, не прогноз результата реального интервью.
      </p>
    </aside>
  );
}

function SourceItem({ icon, title, active, children }: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <li className={active ? 'is-active' : undefined}>
      <span className="career-mock-source-icon">{icon}</span>
      <span className="career-mock-source-copy">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </li>
  );
}

function requirementsDetail(vacancy: MockInterviewVacancy): string {
  const skills = (vacancy.skills ?? []).map((skill) => skill.trim()).filter(Boolean);
  if (skills.length) return capitalize(skills.slice(0, REQUIREMENTS_SHOWN).join(', '));
  return `Текст вакансии не сохранён: вопросы по роли «${vacancy.title}»`;
}

function storiesDetail(stories?: StarStoriesSnapshot | null): string {
  if (!stories) return 'Загружаем истории';
  const confirmed = stories.stories.filter((story) => story.confidence === 'confirmed').length;
  const unconfirmed = stories.stories.length - confirmed;
  return `Подтверждено ${confirmed}, не проверено ${unconfirmed}`;
}

function sourceLine(vacancy: MockInterviewVacancy): string {
  const date = vacancy.sourceSavedAt ? formatSourceDate(vacancy.sourceSavedAt) : null;
  const origin = vacancy.source ? `вакансия ${vacancy.source}` : 'вакансия';
  return `Источник: ${[origin, 'профиль', date].filter(Boolean).join(', ')}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1);
}
