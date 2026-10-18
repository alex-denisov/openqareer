import { useEffect, useRef, type RefObject } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import {
  type LinkedinDraft,
  type LinkedinDraftStatus,
  type LinkedinDraftTopic,
} from './linkedinDraftApi';
import type { LinkedinSafetyStopReason } from './linkedinActionSafetyApi';
import type { DraftCardState, LinkedinDraftCardController } from './LinkedinDraftCard';
import { STATUS, cadenceCopy, linkedinStopCopy } from './LinkedinDraftCard';

export function PipelineSummary({
  topics,
  drafts,
  generating,
}: {
  readonly topics: number;
  readonly drafts: readonly LinkedinDraft[];
  readonly generating: boolean;
}) {
  const count = (status: LinkedinDraftStatus) =>
    drafts.filter((draft) => draft.status === status).length;
  return (
    <div className="career-drafts-recent" aria-label="Сводка конвейера">
      <p>Темы по подтверждённым данным профиля: {topics}</p>
      <p>
        В последних {drafts.length} черновиках: {count('draft')} ждут правки, {count('approved')}{' '}
        одобрено, {count('published')} опубликовано по вашему подтверждению.
      </p>
      {generating ? <p role="status">Консультант готовит черновик…</p> : null}
    </div>
  );
}

export function ChoiceSelect({
  id,
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="career-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </>
  );
}

export function DraftForm({
  id,
  controller,
  expanded,
}: {
  readonly id: string;
  readonly controller: LinkedinDraftCardController;
  readonly expanded: boolean;
}) {
  const inputChoices = [
    { value: 'topic', label: 'Только тему' },
    { value: 'text', label: 'Готовый текст' },
    { value: 'sketch', label: 'Набросок' },
  ];
  const toneChoices = [
    { value: 'business', label: 'Деловой' },
    { value: 'personal', label: 'Личный' },
    { value: 'expert', label: 'Экспертный' },
  ];
  const lengthChoices = [
    { value: 'short', label: 'Короткий' },
    { value: 'medium', label: 'Средний' },
    { value: 'long', label: 'Длинный' },
  ];
  // prettier-ignore
  return <form onSubmit={(event) => controller.prepare(event)}>
    <label htmlFor={`${id}-topic`}>Тема</label>
    <textarea id={`${id}-topic`} aria-label="Тема" value={controller.topicText} onChange={(event) => controller.setTopicText(event.target.value)} maxLength={2000} rows={3} required disabled={controller.busy} placeholder="Тема, мысль или готовый текст. Например: как мы сократили релиз с 14 до 3 дней." />
    {expanded ? <ChoiceSelect id={`${id}-input-type`} label="Что вы даёте" value={controller.inputType} disabled={controller.busy} onChange={(value) => controller.setInputType(value as DraftCardState['inputType'])} choices={inputChoices} /> : null}
    <div className="career-drafts-kinds" role="group" aria-label="Вид черновика">{(['comment', 'post'] as const).map((value) => <ActionButton key={value} label={value === 'comment' ? 'Комментарий' : 'Пост'} pressed={controller.kind === value} disabled={controller.busy} onClick={() => controller.setKind(value)} />)}</div>
    {controller.kind === 'comment' ? <><label htmlFor={`${id}-source`}>Текст поста, на который отвечаете (необязательно)</label><textarea id={`${id}-source`} value={controller.sourceText} onChange={(event) => controller.setSourceText(event.target.value)} maxLength={2000} rows={2} disabled={controller.busy} /></> : null}
    {expanded ? <ChoiceSelect id={`${id}-tone`} label="Тон" value={controller.tone} disabled={controller.busy} onChange={(value) => controller.setTone(value as DraftCardState['tone'])} choices={toneChoices} /> : null}
    {expanded ? <ChoiceSelect id={`${id}-length`} label="Длина" value={controller.length} disabled={controller.busy} onChange={(value) => controller.setLength(value as DraftCardState['length'])} choices={lengthChoices} /> : null}
    <button type="submit" className="career-btn career-btn-secondary" disabled={controller.busy} aria-busy={controller.busy}>{controller.busy ? 'Готовлю…' : 'Подготовить черновик'}</button>
  </form>;
}

export function RecentDrafts({
  drafts,
  controller,
}: {
  readonly drafts: readonly LinkedinDraft[];
  readonly controller: LinkedinDraftCardController;
}) {
  const latest = drafts[0];
  return latest ? (
    <div className="career-drafts-result">
      <p>{latest.text}</p>
      {latest.status === 'draft' || latest.status === 'copied' ? (
        <div className="career-drafts-kinds">
          {latest.status === 'draft' ? (
            <ActionButton
              label="Скопировать"
              disabled={controller.busyDraftId === latest.id}
              onClick={() => controller.changeStatus(latest, 'copied')}
            />
          ) : (
            <ActionButton label="Скопировано" disabled />
          )}
          <ActionButton
            label="Отклонить"
            disabled={controller.busyDraftId === latest.id}
            onClick={() => controller.changeStatus(latest, 'rejected')}
          />
        </div>
      ) : null}
      <ul className="career-drafts-recent" aria-label="Последние черновики">
        {drafts.slice(0, 3).map((draft) => (
          <li key={draft.id}>
            {draft.topic} · <span>{STATUS[draft.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

export function ActionButton({
  label,
  disabled,
  pressed,
  onClick,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button
      className="career-btn career-btn-secondary"
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function TopicsSection({
  controller,
}: {
  readonly controller: LinkedinDraftCardController;
}) {
  const { topics, topicTotal, topicsLoading, hasMoreTopics } = controller;
  return (
    <section className="career-drafts-result" aria-labelledby="linkedin-topics-title">
      <p id="linkedin-topics-title">
        <strong>Темы от консультанта</strong>
      </p>
      <p>Идеи основаны на подтверждённых фактах профиля и резюме; источник указан у каждой темы.</p>
      {topicsLoading && !topics.length ? (
        <p role="status" aria-busy="true">
          Загружаем темы…
        </p>
      ) : null}
      {!topicsLoading && !topics.length ? (
        <p>
          Подтверждённых фактов для тем пока нет. Добавьте данные в профиле или предложите свою
          тему.
        </p>
      ) : null}
      {topics.length ? (
        <ul className="career-drafts-recent" aria-label="Темы от консультанта">
          {topics.map((item) => (
            <TopicRow key={item.id} topic={item} controller={controller} />
          ))}
        </ul>
      ) : null}
      {hasMoreTopics ? (
        <ActionButton
          label="Показать ещё темы"
          disabled={topicsLoading}
          onClick={controller.showMoreTopics}
        />
      ) : null}
      {topicTotal ? <p>Доступно тем по данным профиля: {topicTotal}.</p> : null}
    </section>
  );
}

export function TopicRow({
  topic,
  controller,
}: {
  readonly topic: LinkedinDraftTopic;
  readonly controller: LinkedinDraftCardController;
}) {
  return (
    <li>
      <strong>{topic.title}</strong> · <span>{topic.source}</span>
      <div className="career-drafts-kinds">
        <ActionButton
          label="Взять в работу"
          disabled={controller.busyTopicId === topic.id || controller.busy}
          onClick={() => controller.startTopic(topic)}
        />
        <ActionButton
          label="Скрыть тему"
          disabled={controller.busyTopicId === topic.id || controller.busy}
          onClick={() => controller.dismissTopic(topic)}
        />
      </div>
    </li>
  );
}

export function DraftsSection({
  controller,
}: {
  readonly controller: LinkedinDraftCardController;
}) {
  const visibleDrafts = controller.drafts.slice(0, controller.visibleDraftCount);
  return (
    <section className="career-drafts-result" aria-labelledby="linkedin-drafts-title">
      <p id="linkedin-drafts-title">
        <strong>Черновики и публикация</strong>
      </p>
      {controller.draftsLoading && !visibleDrafts.length ? (
        <p role="status" aria-busy="true">
          Загружаем черновики…
        </p>
      ) : null}
      {!controller.draftsLoading && !visibleDrafts.length ? (
        <p>Черновиков пока нет. Выберите тему или предложите свою.</p>
      ) : null}
      {visibleDrafts.length ? (
        <ul className="career-drafts-recent" aria-label="Черновики и публикация">
          {visibleDrafts.map((draft) => (
            <DraftRow key={draft.id} draft={draft} controller={controller} />
          ))}
        </ul>
      ) : null}
      {visibleDrafts.length ? (
        <p>
          Показаны {visibleDrafts.length} из {controller.drafts.length} загруженных черновиков.
        </p>
      ) : null}
      {controller.drafts.length > controller.visibleDraftCount ? (
        <ActionButton
          label="Показать ещё черновики"
          disabled={controller.draftsLoading}
          onClick={controller.showMoreDrafts}
        />
      ) : null}
      {!controller.cadence.canPublish && controller.cadence.nextAllowedAt ? (
        <p>{cadenceCopy(controller.cadence.nextAllowedAt, controller.cadence.timezone)}</p>
      ) : null}
    </section>
  );
}

export function DraftRow({
  draft,
  controller,
}: {
  readonly draft: LinkedinDraft;
  readonly controller: LinkedinDraftCardController;
}) {
  const editing = controller.editingId === draft.id;
  return (
    <li>
      <strong>{draft.topic}</strong> · <span>{STATUS[draft.status]}</span>
      {editing ? <DraftEditor draft={draft} controller={controller} /> : <p>{draft.text}</p>}
      {!editing ? <DraftActions draft={draft} controller={controller} /> : null}
    </li>
  );
}

export function DraftActions({
  draft,
  controller,
}: {
  readonly draft: LinkedinDraft;
  readonly controller: LinkedinDraftCardController;
}) {
  const busy = controller.busyDraftId === draft.id;
  const editable = !['published', 'rejected'].includes(draft.status);
  // prettier-ignore
  return <div className="career-drafts-kinds">
    {editable ? <ActionButton label="Править" disabled={busy} onClick={() => { controller.setEditingId(draft.id); controller.setEditText(draft.text); }} /> : null}
    {['draft', 'copied'].includes(draft.status) ? <ActionButton label="Одобрить" disabled={busy} onClick={() => controller.changeStatus(draft, 'approved')} /> : null}
    {editable ? <ActionButton label="Отклонить" disabled={busy} onClick={() => controller.changeStatus(draft, 'rejected')} /> : null}
    {draft.status === 'draft' ? <ActionButton label="Скопировать" disabled={busy} onClick={() => controller.changeStatus(draft, 'copied')} /> : null}
    {draft.status === 'copied' ? <ActionButton label="Скопировано" disabled /> : null}
    {draft.status === 'approved' && controller.cadence.canPublish ? <ActionButton label="Скопировать и открыть LinkedIn" disabled={busy} onClick={() => controller.openLinkedin(draft)} /> : null}
    {draft.status === 'approved' && controller.cadence.canPublish ? <ActionButton label="Отметить опубликованным" disabled={busy} onClick={() => controller.setPublishDraft(draft)} /> : null}
    {busy ? <span role="status">Сохраняем…</span> : null}
    {draft.status === 'approved' && !controller.cadence.canPublish ? <span>{cadenceCopy(controller.cadence.nextAllowedAt, controller.cadence.timezone)}</span> : null}
  </div>;
}

export function DraftEditor({
  draft,
  controller,
}: {
  readonly draft: LinkedinDraft;
  readonly controller: LinkedinDraftCardController;
}) {
  return (
    <div className="career-drafts-result">
      <label htmlFor={`linkedin-draft-edit-${draft.id}`}>Текст черновика</label>
      <textarea
        id={`linkedin-draft-edit-${draft.id}`}
        aria-label="Текст черновика"
        value={controller.editText}
        onChange={(event) => controller.setEditText(event.target.value)}
        maxLength={1300}
        rows={6}
        disabled={controller.busyDraftId === draft.id}
      />
      <div className="career-drafts-kinds">
        <ActionButton
          label="Сохранить правку"
          disabled={controller.busyDraftId === draft.id || !controller.editText.trim()}
          onClick={() => controller.saveEdit(draft)}
        />
        <ActionButton
          label="Отмена"
          disabled={controller.busyDraftId === draft.id}
          onClick={() => controller.setEditingId(null)}
        />
      </div>
    </div>
  );
}

export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  open: boolean,
  onCancel: () => void,
) {
  const cancelRef = useRef(onCancel);
  const previousFocus = useRef<HTMLElement | null>(null);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!open) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) =>
      trapDialogKeyboard(event, dialogRef, cancelRef.current);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [dialogRef, open]);
}

export function trapDialogKeyboard(
  event: KeyboardEvent,
  dialogRef: RefObject<HTMLElement | null>,
  onCancel: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key !== 'Tab') return;
  const buttons = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
  if (!buttons?.length) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function PublishConfirmation({
  controller,
}: {
  readonly controller: LinkedinDraftCardController;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, Boolean(controller.publishDraft), () =>
    controller.setPublishDraft(null),
  );
  if (!controller.publishDraft) return null;
  return (
    <div className="career-modal-backdrop">
      <section
        ref={dialogRef}
        className="career-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="linkedin-publish-confirm-title"
      >
        <header className="career-modal-header">
          <h2 id="linkedin-publish-confirm-title">Подтверждение публикации</h2>
        </header>
        <div className="career-modal-body">
          <p>Вы уже опубликовали этот текст в LinkedIn? Платформа не публикует его за вас.</p>
        </div>
        <footer className="career-modal-footer">
          <ActionButton
            label="Да, отметить"
            disabled={controller.busyDraftId === controller.publishDraft.id}
            onClick={controller.markPublished}
          />
          <ActionButton
            label="Ещё нет"
            disabled={controller.busyDraftId === controller.publishDraft.id}
            onClick={() => controller.setPublishDraft(null)}
          />
        </footer>
      </section>
    </div>
  );
}

export function SafetyStopNotice({
  reason,
  canResume,
  resuming,
  onResume,
}: {
  readonly reason: LinkedinSafetyStopReason | null;
  readonly canResume: boolean;
  readonly resuming: boolean;
  readonly onResume: () => void;
}) {
  return (
    <div className="career-drafts-safety-stop" role="status" aria-busy={resuming}>
      <WarningCircle className="career-drafts-safety-stop__icon" aria-hidden="true" />
      <div className="career-drafts-safety-stop__content">
        <p className="career-drafts-safety-stop__title">
          <strong>Действия LinkedIn приостановлены</strong>
        </p>
        <p>{linkedinStopCopy(reason)}</p>
        {canResume ? (
          <button
            type="button"
            className="career-btn career-btn-secondary"
            disabled={resuming}
            aria-busy={resuming}
            onClick={onResume}
          >
            {resuming ? 'Снимаем паузу…' : 'Возобновить вручную'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
