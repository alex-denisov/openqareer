import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Buildings, ChatCircleDots, Check, Copy, Target, X } from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import { StarStoriesModal } from './StarStoriesModal';
import { MockInterviewSimulator } from './MockInterviewSimulator';
import type { InterviewDiaryPort, MockInterviewVacancy } from './mockInterviewSimulatorTypes';
import { useModalAccessibility } from './interviewModalAccessibility';
import {
  generateInterviewPrepBrief,
  type CompanyOverview,
  type InterviewerFocus,
  type InterviewPrepBrief,
  type StarQuestion,
} from './interviewPrepEngine';

export type InterviewPrepTab = 'overview' | 'star' | 'questions';

export interface InterviewPrepModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly vacancy: MockInterviewVacancy;
  readonly facts?: readonly CandidateMemory[];
  readonly candidateName?: string;
  readonly initialTab?: InterviewPrepTab;
  readonly onAskConsultant?: () => void;
  readonly onOpenStarStories?: () => void;
  readonly onWriteDiary?: InterviewDiaryPort;
}

export function InterviewPrepModal(props: InterviewPrepModalProps) {
  return <InterviewPrepModalState {...props} />;
}

function InterviewPrepModalState(props: InterviewPrepModalProps) {
  const [tab, setTab] = useState<InterviewPrepTab>(props.initialTab ?? 'overview');
  const [mockInterviewOpen, setMockInterviewOpen] = useState(false);
  const [starStoriesOpen, setStarStoriesOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const afterStarStoriesClose = useRef<(() => void) | null>(null);
  const setDialogRef = useCallback((node: HTMLDivElement | null) => { cardRef.current = node; }, []);
  const openStarStories = useCallback((afterClose?: () => void) => {
    afterStarStoriesClose.current = afterClose ?? null;
    setStarStoriesOpen(true);
  }, []);
  const closeStarStories = useCallback(() => {
    setStarStoriesOpen(false);
    afterStarStoriesClose.current?.();
    afterStarStoriesClose.current = null;
  }, []);
  const onClose = props.onClose;
  const handleEscape = useCallback(() => {
    if (mockInterviewOpen) setMockInterviewOpen(false);
    else onClose();
  }, [mockInterviewOpen, onClose]);
  useModalAccessibility(props.isOpen, handleEscape, cardRef);
  if (!props.isOpen) return null;
  const brief = generateInterviewPrepBrief({
    vacancy: props.vacancy,
    candidateName: props.candidateName,
    facts: props.facts ?? [],
  });
  const portal = (
    <InterviewPrepOverlay
      props={props}
      tab={tab}
      brief={brief}
      cardRef={cardRef}
      dialogRef={setDialogRef}
      mockInterviewOpen={mockInterviewOpen}
      starStoriesOpen={starStoriesOpen}
      setTab={setTab}
      setMockInterviewOpen={setMockInterviewOpen}
      openStarStories={openStarStories}
      closeStarStories={closeStarStories}
    />
  );
  if (typeof document === 'undefined') return portal;
  const portalRoot = document.querySelector<HTMLElement>('.career-shell') ?? document.body;
  return createPortal(portal, portalRoot);
}

function InterviewPrepOverlay({
  props,
  tab,
  brief,
  cardRef,
  dialogRef,
  mockInterviewOpen,
  starStoriesOpen,
  setTab,
  setMockInterviewOpen,
  openStarStories,
  closeStarStories,
}: {
  readonly props: InterviewPrepModalProps;
  readonly tab: InterviewPrepTab;
  readonly brief: InterviewPrepBrief;
  readonly cardRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly dialogRef: React.RefCallback<HTMLDivElement>;
  readonly mockInterviewOpen: boolean;
  readonly starStoriesOpen: boolean;
  readonly setTab: (tab: InterviewPrepTab) => void;
  readonly setMockInterviewOpen: (open: boolean) => void;
  readonly openStarStories: (afterClose?: () => void) => void;
  readonly closeStarStories: () => void;
}) {
  return (
    <>
      <InterviewPrepBackdrop props={props} tab={tab} brief={brief} cardRef={cardRef} dialogRef={dialogRef} mockInterviewOpen={mockInterviewOpen} setTab={setTab} setMockInterviewOpen={setMockInterviewOpen} openStarStories={openStarStories} />
      <StarStoriesLayer props={props} open={starStoriesOpen} onClose={closeStarStories} />
    </>
  );
}

function InterviewPrepBackdrop({ props, tab, brief, cardRef, dialogRef, mockInterviewOpen, setTab, setMockInterviewOpen, openStarStories }: {
  readonly props: InterviewPrepModalProps;
  readonly tab: InterviewPrepTab;
  readonly brief: InterviewPrepBrief;
  readonly cardRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly dialogRef: React.RefCallback<HTMLDivElement>;
  readonly mockInterviewOpen: boolean;
  readonly setTab: (tab: InterviewPrepTab) => void;
  readonly setMockInterviewOpen: (open: boolean) => void;
  readonly openStarStories: (afterClose?: () => void) => void;
}) {
  return (
    <div
      className={`career-interview-backdrop ${mockInterviewOpen ? 'career-interview-backdrop--simulator' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        if (!mockInterviewOpen && !cardRef.current?.contains(event.target as Node)) props.onClose();
      }}
    >
      {mockInterviewOpen ? (
        <MockInterviewSimulator
          vacancy={props.vacancy}
          dialogRef={dialogRef}
          onBackToPreparation={() => setMockInterviewOpen(false)}
          onOpenStarStories={openStarStories}
          onAskConsultant={props.onAskConsultant}
          onWriteDiary={props.onWriteDiary}
        />
      ) : (
        <InterviewPrepDialog props={props} tab={tab} brief={brief} dialogRef={dialogRef} onTabChange={setTab} onStart={() => setMockInterviewOpen(true)} />
      )}
    </div>
  );
}

function StarStoriesLayer({ props, open, onClose }: { readonly props: InterviewPrepModalProps; readonly open: boolean; readonly onClose: () => void }) {
  return <StarStoriesModal isOpen={open} onClose={onClose} onAskConsultant={props.onAskConsultant} />;
}

function InterviewPrepDialog({
  props,
  tab,
  brief,
  dialogRef,
  onTabChange,
  onStart,
}: {
  readonly props: InterviewPrepModalProps;
  readonly tab: InterviewPrepTab;
  readonly brief: InterviewPrepBrief;
  readonly dialogRef: React.RefCallback<HTMLDivElement>;
  readonly onTabChange: (tab: InterviewPrepTab) => void;
  readonly onStart: () => void;
}) {
  return (
    <div className="career-interview-modal" role="dialog" aria-modal="true" aria-labelledby="career-interview-title" tabIndex={-1} ref={dialogRef}>
      <InterviewHeader
        title={props.vacancy.title}
        company={props.vacancy.company}
        onClose={props.onClose}
        onAskConsultant={props.onAskConsultant}
        onStartMockInterview={onStart}
      />
      <InterviewTabNav tab={tab} onTabChange={onTabChange} />
      <main className="career-interview-body">
        <InterviewTabContent tab={tab} brief={brief} onOpenStarStories={props.onOpenStarStories} />
      </main>
    </div>
  );
}

function InterviewTabContent({
  tab,
  brief,
  onOpenStarStories,
}: {
  readonly tab: InterviewPrepTab;
  readonly brief: InterviewPrepBrief;
  readonly onOpenStarStories?: () => void;
}) {
  if (tab === 'overview') {
    return <OverviewTab overview={brief.companyOverview} focus={brief.interviewerFocus} />;
  }
  if (tab === 'star') {
    return <StarTab questions={brief.starQuestions} onOpenStarStories={onOpenStarStories} />;
  }
  return <QuestionsTab questions={brief.counterQuestions} />;
}

function InterviewHeader({
  title,
  company,
  onClose,
  onAskConsultant,
  onStartMockInterview,
}: {
  readonly title: string;
  readonly company?: string;
  readonly onClose: () => void;
  readonly onAskConsultant?: () => void;
  readonly onStartMockInterview: () => void;
}) {
  return (
    <header className="career-interview-header">
      <div className="career-interview-title-block">
        <div className="career-interview-title-row">
          <h2 id="career-interview-title" className="career-interview-title">
            Интервью: «{title}»{company ? `, ${company}` : ''}
          </h2>
          <InterviewHeaderActions onStart={onStartMockInterview} onAskConsultant={onAskConsultant} />
        </div>
        <p className="career-interview-subtitle">
          Справка — из текста вакансии; ответы — из фактов профиля. Это заготовки, не скрипт.
        </p>
      </div>
      <button
        type="button"
        className="career-interview-close-btn"
        onClick={onClose}
        aria-label="Закрыть модальное окно"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

function InterviewHeaderActions({ onStart, onAskConsultant }: { readonly onStart: () => void; readonly onAskConsultant?: () => void }) {
  return (
    <>
      <button type="button" className="career-btn career-btn-primary career-btn-sm career-interview-launch-btn" onClick={onStart}>
        <ArrowRight aria-hidden="true" />
        <span>Начать мок-интервью</span>
      </button>
      {onAskConsultant ? (
        <button type="button" className="career-btn career-btn-secondary career-ask-consultant-btn" onClick={onAskConsultant}>
          <ChatCircleDots size={16} aria-hidden="true" />
          <span>Спросить консультанта</span>
        </button>
      ) : null}
    </>
  );
}

const TAB_CONFIG = [
  { id: 'overview' as const, label: 'Компания и что им важно', icon: Buildings },
  { id: 'star' as const, label: 'Вопросы к вам (STAR)', icon: Target },
  { id: 'questions' as const, label: 'Ваши вопросы им', icon: ChatCircleDots },
] as const;

function InterviewTabNav({
  tab,
  onTabChange,
}: {
  readonly tab: InterviewPrepTab;
  readonly onTabChange: (tab: InterviewPrepTab) => void;
}) {
  return (
    <div
      className="career-interview-tabs"
      role="tablist"
      aria-label="Разделы подготовки к интервью"
    >
      {TAB_CONFIG.map((item) => {
        const Icon = item.icon;
        const isActive = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`career-tab-btn ${isActive ? 'is-active' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function OverviewTab({
  overview,
  focus,
}: {
  readonly overview: CompanyOverview;
  readonly focus: InterviewerFocus;
}) {
  return (
    <div className="career-interview-overview">
      <section className="career-interview-section">
        <h3>Чем занимаются и на чём работают</h3>
        <p className="career-interview-summary">{overview.summary}</p>
        <p className="career-interview-source-note">{overview.sourceNote}</p>
        <div className="career-interview-chips">
          {overview.techStack.map((tech) => (
            <span key={tech} className="career-interview-chip">
              {tech}
            </span>
          ))}
        </div>
      </section>

      <section className="career-interview-section">
        <h3>С чем придётся иметь дело</h3>
        <ul className="career-interview-list">
          {overview.challenges.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="career-interview-section">
        <h3>На что сделать упор</h3>
        <ul className="career-interview-list">
          {focus.recommendations.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section className="career-interview-section">
        <h3>О чём спросят вероятнее всего</h3>
        <ul className="career-interview-list">
          {focus.keyThemes.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StarTab({
  questions,
  onOpenStarStories,
}: {
  readonly questions: readonly StarQuestion[];
  readonly onOpenStarStories?: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyAnswer = async (q: StarQuestion) => {
    const formatted = [
      `Вопрос: ${q.question}`,
      `Ситуация (Situation): ${q.starAnswer.situation}`,
      `Задача (Task): ${q.starAnswer.task}`,
      `Действие (Action): ${q.starAnswer.action}`,
      `Результат (Result): ${q.starAnswer.result}`,
    ].join('\n\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(formatted);
      setCopiedId(q.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  return (
    <div className="career-interview-star-list">
      {onOpenStarStories ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={onOpenStarStories}
        >
          Открыть STAR-истории
        </button>
      ) : null}
      <p className="career-cabinet-tag">
        STAR: ситуация → задача → что сделали вы → результат в цифрах.
      </p>
      {questions.map((q) => (
        <StarQuestionCard
          key={q.id}
          question={q}
          isCopied={copiedId === q.id}
          onCopy={() => void handleCopyAnswer(q)}
        />
      ))}
    </div>
  );
}

function categoryLabel(cat: StarQuestion['category']): string {
  if (cat === 'technical') return 'Технический вопрос';
  if (cat === 'behavioral') return 'Поведенческий вопрос';
  return 'Мотивация и цели';
}

function StarStepsDefinition({ answer }: { readonly answer: StarQuestion['starAnswer'] }) {
  return (
    <dl className="career-star-steps">
      <div className="career-star-step">
        <dt>Ситуация:</dt>
        <dd>{answer.situation}</dd>
      </div>
      <div className="career-star-step">
        <dt>Задача:</dt>
        <dd>{answer.task}</dd>
      </div>
      <div className="career-star-step">
        <dt>Действие:</dt>
        <dd>{answer.action}</dd>
      </div>
      <div className="career-star-step">
        <dt>Результат:</dt>
        <dd>{answer.result}</dd>
      </div>
    </dl>
  );
}

function StarQuestionCard({
  question,
  isCopied,
  onCopy,
}: {
  readonly question: StarQuestion;
  readonly isCopied: boolean;
  readonly onCopy: () => void;
}) {
  const { category, question: qText, starAnswer, usedEvidenceIds } = question;
  return (
    <article className="career-star-card">
      <header className="career-star-card-header">
        <div className="career-star-card-meta">
          <span className="career-star-category-badge">{categoryLabel(category)}</span>
          {usedEvidenceIds.length > 0 ? (
            <span className="career-star-evidence-tag">
              {usedEvidenceIds.length} подтверждённых факта в основе
            </span>
          ) : (
            <span className="career-star-evidence-tag is-missing">
              Нужен ваш пример: подтверждённых фактов для этого ответа нет
            </span>
          )}
        </div>
        <h4 className="career-star-question-title">{qText}</h4>
      </header>

      <StarStepsDefinition answer={starAnswer} />

      <footer className="career-star-card-footer">
        <button
          type="button"
          className={`career-star-copy-btn ${isCopied ? 'is-success' : ''}`}
          onClick={onCopy}
          aria-label="Скопировать ответ по структуре STAR"
        >
          {isCopied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          <span>{isCopied ? 'Скопировано' : 'Скопировать'}</span>
        </button>
      </footer>
    </article>
  );
}

function QuestionsTab({ questions }: { readonly questions: readonly string[] }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleCopy = async (text: string, idx: number) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }
  };

  return (
    <div className="career-interview-questions">
      <header className="career-interview-section-header">
        <h3>Ваши вопросы им</h3>
        <p>Задайте их в конце интервью, чтобы понять задачи и культуру команды.</p>
      </header>
      <ol className="career-interview-questions-list">
        {questions.map((q, idx) => (
          <li key={idx} className="career-interview-question-item">
            <p className="career-interview-question-text">{q}</p>
            <button
              type="button"
              className={`career-interview-copy-mini ${copiedIdx === idx ? 'is-success' : ''}`}
              onClick={() => void handleCopy(q, idx)}
              aria-label="Скопировать вопрос"
            >
              {copiedIdx === idx ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              <span>{copiedIdx === idx ? 'Скопировано' : 'Скопировать'}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
