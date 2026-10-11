import { useCallback, useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import type { CareerDiaryWeeklyReview, CareerDiaryOverview } from '../../../shared/careerDiary';
import { formatCareerDiaryDate } from './careerDiaryModel';
import { upsertCareerDiaryReview } from './careerDiaryApi';
import { currentCareerDiaryWeek } from './careerDiaryWeek';
import { CareerDiaryRecordList } from './CareerDiaryRecordList';
import { CareerDiaryWeeklyReviewForm, type CareerDiaryWeeklyReviewDraft } from './CareerDiaryWeeklyReviewForm';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';
import type { CareerDiaryRecord } from './useCareerDiaryRecords';

interface CareerDiaryWeeklyReviewsProps {
  readonly overview: CareerDiaryOverview | null;
  readonly records: readonly CareerDiaryRecord[];
  readonly state: CareerDiaryLoadState;
  readonly error: string | null;
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
  readonly onSaved: () => void;
}

const emptyDraft: CareerDiaryWeeklyReviewDraft = {
  movedForward: '',
  blockers: '',
  learning: '',
  risks: '',
  nextWeek: '',
};

export function CareerDiaryWeeklyReviews(props: CareerDiaryWeeklyReviewsProps) {
  const week = props.overview
    ? currentCareerDiaryWeek(props.overview.asOf, props.overview.primaryWorkplace?.startDate ?? null)
    : null;
  const reviews = props.records.filter(isWeeklyReview);
  const currentReview = week ? reviews.find((review) => review.weekStart === week.weekStart) : undefined;
  const pastReviews = week ? reviews.filter((review) => review.weekStart !== week.weekStart) : [];
  const editor = useCareerDiaryReviewEditor(week?.weekStart ?? null, currentReview, props.onSaved);

  if (!week) {
    return (
      <section className="career-diary-state" role="alert">
        <p>Не удалось определить неделю для разбора без сводки дневника.</p>
        <button className="career-btn is-ghost" type="button" onClick={props.onRetry}>Повторить</button>
      </section>
    );
  }
  return (
    <CareerDiaryWeeklyReviewsContent
      {...props}
      week={week}
      weekTitle={reviewWeekTitle(week.number, week.weekStart, week.weekEnd)}
      currentReview={currentReview}
      pastReviews={pastReviews}
      {...editor}
    />
  );
}

function useCareerDiaryReviewEditor(
  weekStart: string | null,
  currentReview: CareerDiaryWeeklyReview | undefined,
  onSaved: () => void,
) {
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const openForm = useCallback(() => {
    setDraft(currentReview ? reviewDraft(currentReview) : { ...emptyDraft });
    setSaveError(null);
    setSavedNotice(null);
    setFormOpen(true);
  }, [currentReview]);
  const closeForm = useCallback(() => setFormOpen(false), []);
  const saveReview = useCallback(async () => {
    if (!weekStart) {
      setSaveError('Не удалось определить неделю для разбора.');
      return;
    }
    if (!Object.values(draft).some((value) => value.trim())) {
      setSaveError('Добавьте хотя бы один вывод из этой недели.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await upsertCareerDiaryReview(weekStart, { ...draft, weekStart });
      setFormOpen(false);
      setSavedNotice('Разбор сохранён.');
      onSaved();
    } catch {
      setSaveError('Не удалось сохранить разбор. Проверьте соединение и повторите попытку.');
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved, weekStart]);
  const onSave = useCallback(() => { void saveReview(); }, [saveReview]);

  return { formOpen, draft, saving, saveError, savedNotice, onDraftChange: setDraft, onOpenForm: openForm, onCloseForm: closeForm, onSave };
}

function reviewWeekTitle(number: number | null, weekStart: string, weekEnd: string): string {
  const range = formatCareerDiaryDate(weekStart) + '–' + formatCareerDiaryDate(weekEnd);
  return number ? 'Неделя ' + String(number) + ', ' + range : 'Текущая неделя, ' + range;
}

interface CareerDiaryWeeklyReviewsContentProps extends CareerDiaryWeeklyReviewsProps {
  readonly week: ReturnType<typeof currentCareerDiaryWeek>;
  readonly weekTitle: string;
  readonly currentReview?: CareerDiaryWeeklyReview;
  readonly pastReviews: readonly CareerDiaryWeeklyReview[];
  readonly formOpen: boolean;
  readonly draft: CareerDiaryWeeklyReviewDraft;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly savedNotice: string | null;
  readonly onDraftChange: (draft: CareerDiaryWeeklyReviewDraft) => void;
  readonly onOpenForm: () => void;
  readonly onCloseForm: () => void;
  readonly onSave: () => void;
}

function CareerDiaryWeeklyReviewsContent(props: CareerDiaryWeeklyReviewsContentProps) {
  return (
    <div className={`career-diary-review-workspace${props.formOpen ? ' is-editing' : ''}`}>
      <section className="career-diary-review-current" aria-labelledby="career-diary-review-current-title">
        <header className="career-diary-review-current__header">
          <div>
            <h2 id="career-diary-review-current-title" tabIndex={-1}>{props.weekTitle}</h2>
            <p>{props.currentReview ? 'Разбор этой недели сохранён.' : 'Разбор ещё не заполнен.'}</p>
          </div>
          {!props.formOpen ? (
            <button className="career-btn is-primary" type="button" onClick={props.onOpenForm}>
              <CalendarBlank size={18} aria-hidden="true" />
              {props.currentReview ? 'Изменить разбор' : 'Заполнить разбор недели'}{props.week.number ? ' ' + String(props.week.number) : ''}
            </button>
          ) : null}
        </header>
        {props.savedNotice ? <p className="career-diary-status" role="status">{props.savedNotice}</p> : null}
        {props.formOpen ? (
          <CareerDiaryWeeklyReviewForm
            weekTitle={props.weekTitle}
            draft={props.draft}
            saving={props.saving}
            error={props.saveError}
            onDraftChange={props.onDraftChange}
            onClose={props.onCloseForm}
            onSave={props.onSave}
          />
        ) : null}
      </section>
      {!props.formOpen ? (
        <section className="career-diary-review-past">
          <CareerDiaryRecordList
            tab="reviews"
            records={props.pastReviews}
            state={props.state}
            error={props.error}
            nextCursor={props.nextCursor}
            loadingMore={props.loadingMore}
            onRetry={props.onRetry}
            onLoadMore={props.onLoadMore}
          />
        </section>
      ) : null}
    </div>
  );
}

function isWeeklyReview(record: CareerDiaryRecord): record is CareerDiaryWeeklyReview {
  return 'weekStart' in record;
}

function reviewDraft(review: CareerDiaryWeeklyReview): CareerDiaryWeeklyReviewDraft {
  return {
    movedForward: review.movedForward,
    blockers: review.blockers,
    learning: review.learning,
    risks: review.risks,
    nextWeek: review.nextWeek,
  };
}
