import { useCallback, useState } from 'react';
import type {
  RejectionRecommendation,
  RejectionReview,
  RejectionReviewItem,
} from '../../../../shared/rejectionReview';
import { apiErrorMessage } from '../../coach/apiClient';
import {
  ActionDock,
  Button,
  Icon,
  InfoTip,
  Link,
  ResultLine,
  StatusLine,
  useIsMobile,
} from '../kit';
import { buildNodePath } from '../routes';
import { useShell } from '../shell/ShellContext';
import { getRejectionReview, saveReviewFeedback } from './data/rejectionReviewApi';
import { useAsync } from './data/useAsync';
import { longDate, pluralRu } from './model/responseRow';
import { checksBasis } from './model/reviewChecks';
import {
  guessLine,
  recommendationText,
  rejectionsTitle,
  resumePathOf,
  reviewTitle,
} from './model/reviewText';
import { ReviewChecks, ReviewThreshold } from './ReviewChecks';

/** Ширина полосы шагами по 5 %: атрибут `style` в кабинете запрещён. */
export function meterStep(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 20) * 5));
}

const FORMS = ['отклик', 'отклика', 'откликов'] as const;

function DataMeter({ review }: { readonly review: RejectionReview }) {
  const { sentCount: count, threshold } = review;
  return (
    <div className="md-meter">
      <span className="num">{`${count} из ${threshold}`}</span>
      <span
        className="meter"
        role="img"
        aria-label={`${count} ${pluralRu(count, FORMS)} из ${threshold} нужных`}
      >
        <i className={`rs-w-${meterStep(count, threshold)}`} />
      </span>
    </div>
  );
}

interface RejectedListProps {
  readonly items: readonly RejectionReviewItem[];
  /** Всего отказов: список показывает не больше 20. */
  readonly total: number;
}

function RejectedList({ items, total }: RejectedListProps) {
  if (items.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="rj-title">
      <h3 className="mod-title" id="rj-title">
        {rejectionsTitle(items, total)}
      </h3>
      <ul className="rows">
        {items.map((item) => (
          <li className="row" key={item.applicationId}>
            <div>
              <div className="row-title">{item.title || 'Без названия'}</div>
              <div className="row-sub">
                {[item.company, longDate(item.rejectedAt)].filter(Boolean).join(' · ')}
              </div>
              {item.guess ? <div className="row-sub">{guessLine(item.guess)}</div> : null}
            </div>
            <Link
              className="icon-btn"
              to={buildNodePath('o01c', { responseId: item.applicationId })}
              aria-label={`Открыть отклик: ${item.company ?? item.title}`}
            >
              <Icon name="right" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface StepActionProps {
  readonly step: RejectionRecommendation;
  readonly rejections: readonly RejectionReviewItem[];
  readonly primary: boolean;
}

/** «Поправить резюме» — готовая правка у консультанта над «Резюме» отклика (k06); остальное — переход. */
function StepButton({ step, rejections, primary }: StepActionProps) {
  const { navigate, openConsultant } = useShell();
  const text = recommendationText(step);
  const { resumeFactId } = step;
  if (resumeFactId) {
    return (
      <Button
        variant={primary ? 'primary' : undefined}
        icon={text.icon}
        onClick={() => {
          const path = resumePathOf(step, rejections);
          openConsultant({ kind: 'dialog', resumeFactId, resumeReason: text.why });
          if (path) navigate(path);
        }}
      >
        {text.action}
      </Button>
    );
  }
  return (
    <Link className={primary ? 'btn is-primary' : 'btn'} to={buildNodePath(text.node)}>
      <Icon name={text.icon} />
      {text.action}
    </Link>
  );
}

interface OtherStepsProps {
  readonly steps: readonly RejectionRecommendation[];
  readonly rejections: readonly RejectionReviewItem[];
}

function OtherSteps({ steps, rejections }: OtherStepsProps) {
  if (steps.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="fn-alt">
      <h3 className="mod-title" id="fn-alt">
        Другие рекомендации
      </h3>
      <ol className="rec-list" start={2}>
        {steps.map((step, index) => {
          const text = recommendationText(step);
          return (
            <li className="rec-card" key={`${step.kind}-${step.requirement}`}>
              <span className="rec-n num" aria-hidden="true">
                {index + 2}
              </span>
              <div className="rec-body">
                <h4 className="rec-t">{text.title}</h4>
                <p className="rec-why">{text.why}</p>
                <div className="actions">
                  <StepButton step={step} rejections={rejections} primary={false} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type Vote =
  { readonly kind: 'idle' | 'busy' | 'done' } | { readonly kind: 'error'; readonly text: string };

/** «Разбор помог?»: ответ сохраняется, результат остаётся на месте. */
function Helped({ initial }: { readonly initial: boolean | null }) {
  const [helped, setHelped] = useState(initial);
  const [vote, setVote] = useState<Vote>({ kind: 'idle' });
  const busy = vote.kind === 'busy';

  function answer(value: boolean) {
    setVote({ kind: 'busy' });
    saveReviewFeedback(value)
      .then(() => {
        setHelped(value);
        setVote({ kind: 'done' });
      })
      .catch((reason: unknown) =>
        setVote({
          kind: 'error',
          text: apiErrorMessage(reason, 'Ответ не сохранился. Повторите.'),
        }),
      );
  }

  return (
    <section className="mod" aria-labelledby="fn-use">
      <h3 className="mod-title" id="fn-use">
        Разбор помог?
      </h3>
      <div className="actions">
        <Button
          icon="check"
          aria-pressed={helped === true}
          busy={busy}
          onClick={() => answer(true)}
        >
          Да
        </Button>
        <Button
          icon="close"
          aria-pressed={helped === false}
          busy={busy}
          onClick={() => answer(false)}
        >
          Нет
        </Button>
      </div>
      {vote.kind === 'done' ? <ResultLine text="Спасибо, ответ записан" /> : null}
      {vote.kind === 'error' ? <StatusLine state="err" text={vote.text} /> : null}
    </section>
  );
}

/**
 * Главное действие экрана. На 390 — закреплённая полоса над навигацией (она сама оставляет
 * место под собой); на 1440 и 1176 кнопка стоит в блоке, как в макете.
 */
function LeadAction({ review }: { readonly review: RejectionReview }) {
  const step = review.firstStep;
  const mobile = useIsMobile();
  const link = step ? (
    <StepButton step={step} rejections={review.rejections} primary />
  ) : (
    <Link className="btn is-primary" to={buildNodePath('s07')}>
      <Icon name="vacancies" />
      Посмотреть вакансии
    </Link>
  );
  return mobile ? <ActionDock kind="auto" primary={link} /> : <div className="actions">{link}</div>;
}

function ReviewLead({ review }: { readonly review: RejectionReview }) {
  const step = review.firstStep;
  const low = review.state === 'low_data';
  return (
    <section className={low ? 'lead' : 'lead rec-lead'} aria-labelledby="fn-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="fn-title">
          {reviewTitle(review)}
        </h2>
        <InfoTip
          label="Откуда числа"
          text={
            low && review.checks
              ? checksBasis(review.checks, review.threshold)
              : `Ваши отправленные отклики: ${review.sentCount}, отказов: ${review.rejectedCount}. Требования — из текста вакансий, факты — из вашего профиля. Порог для выводов — ${review.threshold} откликов.`
          }
        />
      </div>
      {low ? <DataMeter review={review} /> : null}
      {step && !low ? <p className="lead-text">{recommendationText(step).why}</p> : null}
      {/* B645: при малых данных главное действие — в первой из трёх проверок, как в O7c. */}
      {low && review.checks ? <ReviewChecks checks={review.checks} /> : <LeadAction review={review} />}
    </section>
  );
}

function Review({ review }: { readonly review: RejectionReview }) {
  const ready = review.state === 'ready';
  return (
    <div className="page two" data-b640-node="o07" data-b640-section="responses">
      <div className="col">
        <ReviewLead review={review} />
        <RejectedList items={review.rejections} total={review.rejectedCount} />
      </div>
      <div className="col">
        {!ready && review.checks ? <ReviewThreshold threshold={review.threshold} /> : null}
        {ready ? <OtherSteps steps={review.recommendations} rejections={review.rejections} /> : null}
        {ready && review.firstStep ? <Helped initial={review.helped} /> : null}
      </div>
    </div>
  );
}

/** «Разбор отказов» (O7) и «мало данных» (O7c): данные — механика разбора B679. */
export function ReviewScreen() {
  const load = useCallback((signal: AbortSignal) => getRejectionReview(signal), []);
  const { state, reload } = useAsync(load, 'Разбор не загрузился.');
  if (state.data) return <Review review={state.data} />;
  return (
    <div className="page two" data-b640-node="o07" data-b640-section="responses">
      {state.status === 'error' ? (
        <StatusLine
          state="err"
          text={state.error}
          action={
            <Button size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        />
      ) : (
        <p className="ls-state" role="status">
          Загружаем разбор…
        </p>
      )}
    </div>
  );
}
