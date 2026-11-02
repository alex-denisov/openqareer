import type { ReactNode } from 'react';
import {
  CaretDown,
  CaretRight,
  LinkSimple,
  ListChecks,
  Microphone,
  Notebook,
  Notepad,
  PencilSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import type { StarStoriesSnapshot, StarStoryView } from '../../../shared/starStories';
import { STAR_FIELDS } from '../../../shared/starStories';
import type { ApplicationView } from './applicationsApi';
import { InterviewDebriefControl } from './ResponsesCardStageControls';
import { humanSourceLabel } from './sourceLabels';

export interface StarStoriesState {
  readonly snapshot?: StarStoriesSnapshot;
  readonly loading: boolean;
  readonly error?: string;
  readonly retry: () => void;
}

const STORIES_SHOWN = 4;
const CARD_CLASS = 'career-prep-card';

export function SectionCard({
  id,
  title,
  count,
  actions,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: number;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className={CARD_CLASS} aria-labelledby={id}>
      <div className="career-prep-head">
        <h2 id={id}>{title}</h2>
        {count === undefined ? null : <span className="career-prep-tag">{count}</span>}
        {actions}
      </div>
      <div className="career-prep-list">{children}</div>
    </section>
  );
}

export function StarStoriesCard({
  stories,
  onEdit,
  onOpenAll,
}: {
  readonly stories: StarStoriesState;
  readonly onEdit: (story: StarStoryView) => void;
  readonly onOpenAll: () => void;
}) {
  const list = stories.snapshot?.stories ?? [];
  return (
    <SectionCard
      id="responses-star-title"
      title="STAR на фактах профиля"
      count={stories.snapshot ? list.length : undefined}
      actions={
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm career-prep-open-all"
          onClick={onOpenAll}
        >
          <Notebook aria-hidden="true" /> Открыть STAR-истории
        </button>
      }
    >
      <StoryLoadState stories={stories} />
      {list.slice(0, STORIES_SHOWN).map((story) => (
        <StoryRow key={story.id} story={story} onEdit={() => onEdit(story)} />
      ))}
    </SectionCard>
  );
}

function StoryLoadState({ stories }: { readonly stories: StarStoriesState }) {
  if (stories.loading) return <p role="status">Загружаем STAR-истории…</p>;
  if (stories.error) {
    return (
      <p className="career-responses-preparation__error" role="alert">
        <WarningCircle aria-hidden="true" /> {stories.error}
        <button type="button" onClick={stories.retry}>
          Повторить
        </button>
      </p>
    );
  }
  if (stories.snapshot?.stories.length === 0) {
    return (
      <p role="status">
        STAR-историй пока нет. Здесь появятся истории, связанные с подтверждёнными фактами профиля.
      </p>
    );
  }
  return null;
}

function storyCompleteness(story: StarStoryView): string {
  const filled = STAR_FIELDS.filter((field) => story.fields[field].trim().length > 0).length;
  return `Ситуация, задача, действие, результат: заполнено ${filled} из ${STAR_FIELDS.length}`;
}

function storyProvenance(story: StarStoryView): string {
  const confirmation =
    story.confidence === 'confirmed'
      ? 'подтверждено фактами профиля'
      : 'связь с фактами не подтверждена';
  return `Профиль, фактов: ${story.sourceFacts.length} · ${confirmation}`;
}

function StoryRow({
  story,
  onEdit,
}: {
  readonly story: StarStoryView;
  readonly onEdit: () => void;
}) {
  return (
    <div className="career-prep-row">
      <RowIcon icon={<ListChecks />} />
      <div className="career-prep-main">
        <b>{story.title}</b>
        <p>{storyCompleteness(story)}</p>
        <p>
          <span className="career-prep-origin">
            <LinkSimple aria-hidden="true" />
            {storyProvenance(story)}
          </span>
        </p>
      </div>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm career-prep-act"
        aria-label={`Править: ${story.title}`}
        onClick={onEdit}
      >
        <PencilSimple aria-hidden="true" />
        <span className="career-prep-act-label">Править</span>
        <CaretRight className="career-prep-chev" aria-hidden="true" />
      </button>
    </div>
  );
}

export function RowIcon({ icon }: { readonly icon: ReactNode }) {
  return (
    <span className="career-prep-ico" aria-hidden="true">
      {icon}
    </span>
  );
}

export function applicationLabel(application: ApplicationView): string {
  const title = application.vacancy?.title ?? 'Вакансия без названия';
  if (application.vacancy?.companyHidden) return title;
  return `${application.vacancy?.company ?? 'Компания не указана'}, ${title}`;
}

export function MockInterviewCard(props: {
  readonly interviews: readonly ApplicationView[];
  readonly selected?: ApplicationView;
  readonly selectedId: string;
  readonly stress: boolean;
  readonly onSelect: (id: string) => void;
  readonly onStress: (value: boolean) => void;
  readonly onStart: () => void;
}) {
  const { selected } = props;
  return (
    <SectionCard id="responses-interviews-title" title="Мок-интервью">
      {props.interviews.length > 1 ? (
        <InterviewSelect
          interviews={props.interviews}
          value={props.selectedId}
          onChange={props.onSelect}
        />
      ) : null}
      {selected ? (
        <MockInterviewRow application={selected} onStart={props.onStart} />
      ) : (
        <p role="status">В выбранном периоде нет откликов с назначенным этапом интервью.</p>
      )}
      <StressOption checked={props.stress} onChange={props.onStress} />
      <p className="career-prep-foot">
        Стресс-режим (перебивания и жёсткие уточнения) включается перед началом.
      </p>
    </SectionCard>
  );
}

function MockInterviewRow({
  application,
  onStart,
}: {
  readonly application: ApplicationView;
  readonly onStart: () => void;
}) {
  return (
    <div className="career-prep-row">
      <RowIcon icon={<Microphone />} />
      <div className="career-prep-main">
        <b>{applicationLabel(application)}</b>
        <p>Вопросы по требованиям вакансии и вашим STAR.</p>
        <InterviewMaterials application={application} />
      </div>
      <button
        type="button"
        className="career-btn career-btn-primary career-prep-start"
        onClick={onStart}
      >
        <Microphone aria-hidden="true" /> Начать мок-интервью
      </button>
    </div>
  );
}

function StressOption({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label className="career-checkbox-label career-prep-stress">
      <input
        type="checkbox"
        className="career-checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="career-checkbox-text">Стресс-режим: перебивания и жёсткие уточнения</span>
    </label>
  );
}

function InterviewSelect({
  interviews,
  value,
  onChange,
}: {
  readonly interviews: readonly ApplicationView[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}) {
  return (
    <label className="career-prep-select-field">
      <span>Отклик</span>
      <span className="career-select-wrap">
        <select
          className="career-select"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {interviews.map((application) => (
            <option key={application.id} value={application.id}>
              {applicationLabel(application)}
            </option>
          ))}
        </select>
        <CaretDown className="career-select-caret" aria-hidden="true" />
      </span>
    </label>
  );
}

function InterviewMaterials({ application }: { readonly application: ApplicationView }) {
  const source = application.vacancy?.source;
  const scheduledAt = application.nearestInterview?.scheduledAt;
  return (
    <p className="career-prep-materials">
      {scheduledAt ? `Интервью ${formatDateTime(scheduledAt)}` : 'Дата интервью не указана'}
      {' · '}Резюме: {application.materials.resume ? 'подготовлено' : 'не привязано к отклику'}
      {' · '}Письмо: {application.materials.coverLetter ? 'подготовлено' : 'не привязано к отклику'}
      {' · '}Источник: {source ? humanSourceLabel(source) : 'не указан'}
    </p>
  );
}

export function DebriefCard({
  applications,
  onRefresh,
}: {
  readonly applications: readonly ApplicationView[];
  readonly onRefresh: () => void;
}) {
  return (
    <SectionCard id="responses-debrief-title" title="Дебриф">
      {applications.length === 0 ? (
        <p role="status">Интервью, по которым нужен дебриф, пока нет.</p>
      ) : (
        applications.map((application) => (
          <DebriefRow key={application.id} application={application} onRefresh={onRefresh} />
        ))
      )}
    </SectionCard>
  );
}

function DebriefRow({
  application,
  onRefresh,
}: {
  readonly application: ApplicationView;
  readonly onRefresh: () => void;
}) {
  const scheduledAt = application.nearestInterview?.scheduledAt;
  const when = scheduledAt ? `, интервью ${formatDate(scheduledAt)}` : '';
  return (
    <div className="career-prep-row">
      <RowIcon icon={<Notepad />} />
      <div className="career-prep-main">
        <b>{`${applicationLabel(application)}${when}`}</b>
        <p>Запишите, что спросили и что не получилось: 5 минут.</p>
      </div>
      <InterviewDebriefControl
        application={application}
        onRefresh={onRefresh}
        label={
          <>
            <span className="career-prep-act-label">Заполнить</span>
            <CaretRight className="career-prep-chev" aria-hidden="true" />
          </>
        }
        buttonClassName="career-btn career-btn-secondary career-btn-sm career-prep-act"
      />
    </div>
  );
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'дата не указана'
    : date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}
