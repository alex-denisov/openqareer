import { useEffect, type ReactNode } from 'react';
import { CaretRight, ListChecks, Microphone, Notepad, PencilSimple } from '@phosphor-icons/react';
import { STAR_FIELDS, type StarStoryView } from '../../../shared/starStories';
import { FIELD_LABELS } from '../interview/StarStoryCard';
import type { ApplicationView } from './applicationsApi';
import { InterviewDebriefPushForm } from './ResponsesCardStageControls';
import { ResponsesMobilePush } from './ResponsesMobilePush';
import {
  RowIcon,
  SectionCard,
  StoryLoadState,
  StressOption,
  applicationLabel,
  filledStarFields,
  formatDate,
  formatDateTime,
  storyProvenance,
  type StarStoriesState,
} from './ResponsesPreparationSections';
import { humanSourceLabel } from './sourceLabels';

/** 390 push screens of «Подготовка» (mockup 5 `prepx`; the mock and debrief rows push too). */
export type PreparationPushView =
  | { readonly kind: 'story'; readonly id: string }
  | { readonly kind: 'mock'; readonly id: string }
  | { readonly kind: 'debrief'; readonly id: string };

const STORIES_SHOWN = 4;
const STRESS_FOOT = 'Стресс-режим (перебивания и жёсткие уточнения) включается перед началом.';

export interface PreparationMobileProps {
  readonly stories: StarStoriesState;
  readonly interviews: readonly ApplicationView[];
  readonly debriefs: readonly ApplicationView[];
  readonly selectedInterview?: ApplicationView;
  readonly stress: boolean;
  readonly onStress: (value: boolean) => void;
  readonly push: PreparationPushView | null;
  readonly onPush: (view: PreparationPushView | null) => void;
  readonly onEditStory: (story: StarStoryView) => void;
  readonly onOpenAllStories: () => void;
  readonly onStartMock: (applicationId: string, stress: boolean) => void;
  readonly onRefresh: () => void;
  readonly onOpenConsultant?: () => void;
}

/**
 * Макет 5 `vt=p` at 390: grouped row-links that push to their screens. The response
 * choice, the stress mode and the debrief form live on those screens, not on the tab.
 */
export function ResponsesPreparationMobile(props: PreparationMobileProps) {
  if (props.push) {
    return (
      <ResponsesMobilePush
        view={props.push}
        onBack={() => props.onPush(null)}
        onOpenConsultant={props.onOpenConsultant}
      >
        <PreparationPushContent {...props} view={props.push} />
      </ResponsesMobilePush>
    );
  }
  return (
    <>
      <StoryGroup {...props} />
      <MockGroup {...props} />
      <DebriefGroup {...props} />
      {props.selectedInterview ? <StartMockCta onStart={() => startSelected(props)} /> : null}
    </>
  );
}

function startSelected(props: PreparationMobileProps) {
  if (props.selectedInterview) props.onStartMock(props.selectedInterview.id, props.stress);
}

function LinkRow({
  icon,
  title,
  sub,
  label,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly sub?: string;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="career-prep-row career-prep-link"
      aria-label={label}
      onClick={onClick}
    >
      <RowIcon icon={icon} />
      <span className="career-prep-main">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <CaretRight className="career-prep-chev" aria-hidden="true" />
    </button>
  );
}

function storySubline(story: StarStoryView): string {
  const confirmation =
    story.confidence === 'confirmed'
      ? 'подтверждено фактами профиля'
      : 'связь с фактами не подтверждена';
  return `${filledStarFields(story)} из ${STAR_FIELDS.length} · ${confirmation}`;
}

function StoryGroup(props: PreparationMobileProps) {
  const list = props.stories.snapshot?.stories ?? [];
  return (
    <SectionCard
      id="responses-star-title"
      title="STAR на фактах профиля"
      count={props.stories.snapshot ? list.length : undefined}
      actions={
        <button
          type="button"
          className="career-prep-open-all"
          aria-label="Открыть STAR-истории"
          onClick={props.onOpenAllStories}
        >
          Все истории
        </button>
      }
    >
      <StoryLoadState stories={props.stories} />
      {list.slice(0, STORIES_SHOWN).map((story) => (
        <LinkRow
          key={story.id}
          icon={<ListChecks />}
          title={story.title}
          sub={storySubline(story)}
          label={`Открыть историю: ${story.title}`}
          onClick={() => props.onPush({ kind: 'story', id: story.id })}
        />
      ))}
    </SectionCard>
  );
}

function interviewWhen(application: ApplicationView): string {
  const scheduledAt = application.nearestInterview?.scheduledAt;
  return scheduledAt ? `Интервью ${formatDateTime(scheduledAt)}` : 'Дата интервью не указана';
}

function MockGroup(props: PreparationMobileProps) {
  return (
    <SectionCard
      id="responses-interviews-title"
      title="Мок-интервью"
      foot={props.interviews.length > 0 ? STRESS_FOOT : undefined}
    >
      {props.interviews.length === 0 ? (
        <p role="status">В выбранном периоде нет откликов с назначенным этапом интервью.</p>
      ) : (
        props.interviews.map((application) => (
          <LinkRow
            key={application.id}
            icon={<Microphone />}
            title={applicationLabel(application)}
            sub={interviewWhen(application)}
            label={`Мок-интервью: ${applicationLabel(application)}`}
            onClick={() => props.onPush({ kind: 'mock', id: application.id })}
          />
        ))
      )}
    </SectionCard>
  );
}

function debriefTitle(application: ApplicationView): string {
  const scheduledAt = application.nearestInterview?.scheduledAt;
  const when = scheduledAt ? `, интервью ${formatDate(scheduledAt)}` : '';
  return `${applicationLabel(application)}${when}`;
}

function DebriefGroup(props: PreparationMobileProps) {
  return (
    <SectionCard id="responses-debrief-title" title="Дебриф">
      {props.debriefs.length === 0 ? (
        <p role="status">Интервью, по которым нужен дебриф, пока нет.</p>
      ) : (
        props.debriefs.map((application) => (
          <LinkRow
            key={application.id}
            icon={<Notepad />}
            title={debriefTitle(application)}
            sub="Что спросили и что не получилось · 5 минут"
            label={`Дебриф: ${debriefTitle(application)}`}
            onClick={() => props.onPush({ kind: 'debrief', id: application.id })}
          />
        ))
      )}
    </SectionCard>
  );
}

function StartMockCta({ onStart }: { readonly onStart: () => void }) {
  return (
    <div className="career-prep-cta">
      <button type="button" className="career-btn career-btn-primary" onClick={onStart}>
        <Microphone aria-hidden="true" /> Начать мок-интервью
      </button>
    </div>
  );
}

function PreparationPushContent(
  props: PreparationMobileProps & { readonly view: PreparationPushView },
) {
  const { view, onPush } = props;
  const story = props.stories.snapshot?.stories.find((item) => item.id === view.id);
  const interview = props.interviews.find((item) => item.id === view.id);
  const missing = view.kind === 'story' ? !story && !props.stories.loading : !interview;
  // A story deleted in the editor or a response that left «Интервью» closes its screen.
  useEffect(() => {
    if (missing) onPush(null);
  }, [missing, onPush]);
  if (view.kind === 'story') return story ? <StoryPush {...props} story={story} /> : null;
  if (!interview) return null;
  if (view.kind === 'mock') return <MockPush {...props} application={interview} />;
  return (
    <>
      <PushIntro
        title={debriefTitle(interview)}
        sub="Запишите, что спросили и что не получилось: 5 минут."
      />
      <InterviewDebriefPushForm
        application={interview}
        onDone={() => onPush(null)}
        onRefresh={props.onRefresh}
      />
    </>
  );
}

function PushIntro({ title, sub }: { readonly title: string; readonly sub: string }) {
  return (
    <div className="career-responses-mobile-push-intro">
      <h3>{title}</h3>
      <p>{sub}</p>
    </div>
  );
}

function PushList({
  title,
  foot,
  children,
}: {
  readonly title: string;
  readonly foot?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="career-responses-mobile-group" aria-label={title}>
      <h4>{title}</h4>
      <dl className="career-responses-mobile-list">{children}</dl>
      {foot ? <p className="career-prep-foot">{foot}</p> : null}
    </section>
  );
}

function Pair({ term, value }: { readonly term: string; readonly value: string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StoryPush(props: PreparationMobileProps & { readonly story: StarStoryView }) {
  const { story } = props;
  return (
    <>
      <PushIntro title={story.title} sub="STAR из профиля" />
      <PushList title="Структура" foot={storyProvenance(story)}>
        {STAR_FIELDS.map((field) => (
          <Pair
            key={field}
            term={FIELD_LABELS[field]}
            value={story.fields[field].trim() ? 'Заполнено' : 'Не заполнено'}
          />
        ))}
      </PushList>
      <div className="career-prep-card">
        <div className="career-prep-list">
          <LinkRow
            icon={<PencilSimple />}
            title="Править историю"
            sub="Ситуация, задача, действие, результат и факты профиля"
            label={`Править: ${story.title}`}
            onClick={() => props.onEditStory(story)}
          />
        </div>
      </div>
      {props.selectedInterview ? <StartMockCta onStart={() => startSelected(props)} /> : null}
    </>
  );
}

function MockPush(props: PreparationMobileProps & { readonly application: ApplicationView }) {
  const { application } = props;
  const source = application.vacancy?.source;
  const prepared = (value: boolean) => (value ? 'подготовлено' : 'не привязано к отклику');
  return (
    <>
      <PushIntro title={applicationLabel(application)} sub={interviewWhen(application)} />
      <PushList title="Материалы">
        <Pair term="Резюме" value={prepared(application.materials.resume)} />
        <Pair term="Письмо" value={prepared(application.materials.coverLetter)} />
        <Pair term="Источник" value={source ? humanSourceLabel(source) : 'не указан'} />
      </PushList>
      <div className="career-prep-card">
        <div className="career-prep-list">
          <StressOption checked={props.stress} onChange={props.onStress} />
        </div>
        <p className="career-prep-foot">{STRESS_FOOT}</p>
      </div>
      <StartMockCta onStart={() => props.onStartMock(application.id, props.stress)} />
    </>
  );
}
