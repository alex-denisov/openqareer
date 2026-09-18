import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Buildings,
  ChatCircleDots,
  Check,
  Copy,
  Target,
  X,
} from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
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
  readonly vacancy: {
    readonly id: string;
    readonly title: string;
    readonly company?: string;
    readonly descriptionSummary?: string;
    readonly skills?: readonly string[];
    readonly location?: string;
    readonly isRemote?: boolean;
  };
  readonly facts?: readonly CandidateMemory[];
  readonly candidateName?: string;
  readonly initialTab?: InterviewPrepTab;
}

export function InterviewPrepModal(props: InterviewPrepModalProps) {
  const { isOpen, onClose, vacancy, facts = [], candidateName, initialTab = 'overview' } = props;
  const [tab, setTab] = useState<InterviewPrepTab>(initialTab);
  const cardRef = useRef<HTMLDivElement>(null);

  useModalAccessibility(isOpen, onClose, cardRef);

  const brief = useMemo(() => {
    return generateInterviewPrepBrief({ vacancy, candidateName, facts });
  }, [vacancy, candidateName, facts]);

  if (!isOpen) return null;

  return (
    <div
      className="career-interview-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (!cardRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        className="career-interview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="career-interview-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <InterviewHeader title={vacancy.title} company={vacancy.company} onClose={onClose} />
        <InterviewTabNav tab={tab} onTabChange={setTab} />
        <main className="career-interview-body">
          <InterviewTabContent tab={tab} brief={brief} />
        </main>
      </div>
    </div>
  );
}

function InterviewTabContent({
  tab,
  brief,
}: {
  readonly tab: InterviewPrepTab;
  readonly brief: InterviewPrepBrief;
}) {
  if (tab === 'overview') {
    return <OverviewTab overview={brief.companyOverview} focus={brief.interviewerFocus} />;
  }
  if (tab === 'star') {
    return <StarTab questions={brief.starQuestions} />;
  }
  return <QuestionsTab questions={brief.counterQuestions} />;
}

function InterviewHeader({
  title,
  company,
  onClose,
}: {
  readonly title: string;
  readonly company?: string;
  readonly onClose: () => void;
}) {
  return (
    <header className="career-interview-header">
      <div className="career-interview-title-block">
        <h2 id="career-interview-title" className="career-interview-title">
          Подготовка к интервью: {title}
        </h2>
        {company ? <p className="career-interview-subtitle">{company}</p> : null}
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

const TAB_CONFIG = [
  { id: 'overview' as const, label: 'Справка о компании и фокус', icon: Buildings },
  { id: 'star' as const, label: 'Вопросы и ответы (STAR)', icon: Target },
  { id: 'questions' as const, label: 'Вопросы работодателю', icon: ChatCircleDots },
] as const;

function InterviewTabNav({
  tab,
  onTabChange,
}: {
  readonly tab: InterviewPrepTab;
  readonly onTabChange: (tab: InterviewPrepTab) => void;
}) {
  return (
    <div className="career-interview-tabs" role="tablist" aria-label="Разделы подготовки к интервью">
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
        <h3>Справка и технологический контекст</h3>
        <p className="career-interview-summary">{overview.summary}</p>
        <div className="career-interview-chips">
          {overview.techStack.map((tech) => (
            <span key={tech} className="career-interview-chip">
              {tech}
            </span>
          ))}
        </div>
      </section>

      <section className="career-interview-section">
        <h3>Ожидаемые вызовы</h3>
        <ul className="career-interview-list">
          {overview.challenges.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="career-interview-section">
        <h3>Рекомендации для встречи</h3>
        <ul className="career-interview-list">
          {focus.recommendations.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section className="career-interview-section">
        <h3>Ключевые темы обсуждения</h3>
        <ul className="career-interview-list">
          {focus.keyThemes.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StarTab({ questions }: { readonly questions: readonly StarQuestion[] }) {
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
          ) : null}
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
          {isCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{isCopied ? 'Ответ скопирован!' : 'Копировать ответ'}</span>
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
        <h3>Встречные вопросы кандидату для работодателя</h3>
        <p>Задавайте эти вопросы в конце интервью для демонстрации глубины и оценки инженерной культуры.</p>
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
              {copiedIdx === idx ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              <span>{copiedIdx === idx ? 'Скопировано!' : 'Копировать вопрос'}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function useModalAccessibility(
  isOpen: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    containerRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
        ) ?? [],
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus?.();
    };
  }, [isOpen, onClose, containerRef]);
}
