import { historyQuestion, visibleContextLine } from './expertSheetView';

interface HistoryRowProps {
  readonly dateTime: string;
  readonly dateLabel: string;
  readonly sectionTitle: string;
  readonly firstPhrase: string;
  readonly onOpen: () => void;
}

/** Одна строка беседы: дата · раздел · первый вопрос кандидата (A2). */
export function ExpertHistoryRow({
  dateTime,
  dateLabel,
  sectionTitle,
  firstPhrase,
  onOpen,
}: HistoryRowProps) {
  const question = historyQuestion({ firstPhrase });
  return (
    <button
      className="consultant-history-row"
      type="button"
      aria-label={`Открыть беседу: ${question}`}
      onClick={onOpen}
    >
      <time dateTime={dateTime}>{dateLabel}</time>
      <b>{sectionTitle}</b>
      <span>{question}</span>
    </button>
  );
}

/** «Видит: …» под шапкой листа: только то, что уходит с ходом (A3). */
export function ExpertVisibleLine({
  subjectKind,
  hasMarketQuery,
}: {
  readonly subjectKind?: string;
  readonly hasMarketQuery: boolean;
}) {
  return (
    <p className="consultant-visible-line">{visibleContextLine({ subjectKind, hasMarketQuery })}</p>
  );
}
