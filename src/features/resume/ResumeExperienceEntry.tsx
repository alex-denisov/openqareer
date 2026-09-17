import { WarningCircle } from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import type { ResumeDocumentEditor } from './ResumeDocumentView';
import {
  EntryUnknowns,
  EvidenceChip,
  EvidencePicker,
  Field,
  RemoveButton,
} from './ResumeDocumentParts';
import { reviewFlagLabel } from './resumeLabels';
import type { ResumeDraft, ResumeExperience, ResumeUnknown } from './resumeTypes';

type ExperienceDraftEntry = ResumeDraft['experience'][number];

interface ResumeExperienceEntryProps {
  readonly entry: ExperienceDraftEntry;
  readonly projected?: ResumeExperience;
  readonly anchor?: string;
  readonly unknowns: readonly ResumeUnknown[];
  readonly available: readonly CandidateMemory[];
  readonly editor?: ResumeDocumentEditor;
}

export function ResumeExperienceEntry({
  entry,
  projected,
  anchor,
  unknowns,
  available,
  editor,
}: ResumeExperienceEntryProps) {
  const title = projected?.title?.value ?? entry.title;
  const employer = projected?.employer?.value ?? entry.employer;
  const start = projected?.startDate?.value ?? entry.startDate;
  const end = (projected?.current?.value ?? entry.current)
    ? 'настоящее время'
    : (projected?.endDate?.value ?? entry.endDate);
  const period = start && end ? `${start} — ${end}` : (start || end);

  return (
    <div className="career-resume-entry">
      <header className="career-resume-stanford-entry-header">
        <div className="career-resume-stanford-role-dates">
          <strong className="career-resume-stanford-title">{title || 'Должность не указана'}</strong>
          {period ? <span className="career-resume-stanford-dates">{period}</span> : null}
        </div>
        <div className="career-resume-stanford-employer-location">
          <span className="career-resume-stanford-employer">{employer || 'Работодатель не указан'}</span>
          {entry.location ? (
            <span className="career-resume-stanford-location">{entry.location}</span>
          ) : null}
        </div>
      </header>
      <ExperienceFields entry={entry} editor={editor} />
      {anchor ? <p className="career-resume-anchor">Опора роли: {anchor}</p> : null}
      <ExperienceBullets entry={entry} projected={projected} editor={editor} />
      <EntryUnknowns unknowns={unknowns} />
      {editor ? (
        <>
          <EvidencePicker
            label="Добавить результат из факта"
            options={available}
            onPick={(memoryId) => editor.onToggleBullet(entry.id, memoryId)}
          />
          <RemoveButton
            label="Удалить роль"
            onClick={() => editor.onRemoveExperience(entry.id)}
          />
        </>
      ) : null}
    </div>
  );
}

function ExperienceFields({
  entry,
  editor,
}: {
  entry: ExperienceDraftEntry;
  editor?: ResumeDocumentEditor;
}) {
  return (
    <>
      <div className="career-resume-entry-grid">
        <Field
          label="Должность"
          value={entry.title ?? ''}
          placeholder="Не указана"
          readOnly={!editor}
          onChange={(value) => editor?.onExperience(entry.id, { title: value })}
        />
        <Field
          label="Работодатель"
          value={entry.employer ?? ''}
          placeholder="Не указан"
          readOnly={!editor}
          onChange={(value) => editor?.onExperience(entry.id, { employer: value })}
        />
        <ExperienceDates entry={entry} editor={editor} />
      </div>
      <label className="career-resume-checkbox">
        <input
          type="checkbox"
          checked={entry.current}
          disabled={!editor}
          onChange={(event) =>
            editor?.onExperience(entry.id, { current: event.target.checked })
          }
        />
        <span>Работаю здесь сейчас</span>
      </label>
    </>
  );
}

function ExperienceDates({
  entry,
  editor,
}: {
  entry: ExperienceDraftEntry;
  editor?: ResumeDocumentEditor;
}) {
  return (
    <>
      <Field
        label="Начало"
        value={entry.startDate ?? ''}
        placeholder="ГГГГ-ММ"
        mono
        readOnly={!editor}
        onChange={(value) => editor?.onExperience(entry.id, { startDate: value })}
      />
      <Field
        label="Окончание"
        value={entry.endDate ?? ''}
        placeholder="ГГГГ-ММ"
        mono
        disabled={entry.current}
        readOnly={!editor}
        onChange={(value) => editor?.onExperience(entry.id, { endDate: value })}
      />
    </>
  );
}

function ExperienceBullets({
  entry,
  projected,
  editor,
}: {
  entry: ExperienceDraftEntry;
  projected?: ResumeExperience;
  editor?: ResumeDocumentEditor;
}) {
  if (!projected) {
    return (
      <p className="career-resume-empty">
        Роль не попала в документ: её опорный факт больше не подтверждён.
      </p>
    );
  }
  if (projected.bullets.length === 0) {
    return (
      <p className="career-resume-empty">
        Ни одного подтверждённого результата у этой роли.
      </p>
    );
  }
  return (
    <ul className="career-resume-bullets">
      {projected.bullets.map((bullet) => (
        <BulletRow
          key={bullet.memoryId}
          bullet={bullet}
          onDetach={
            editor ? () => editor.onToggleBullet(entry.id, bullet.memoryId) : undefined
          }
        />
      ))}
    </ul>
  );
}

function BulletRow({
  bullet,
  onDetach,
}: {
  bullet: ResumeExperience['bullets'][number];
  onDetach?: () => void;
}) {
  const clusterMatch = bullet.value.match(/^([A-Za-z0-9\s-]+:)\s*(.*)$/u);

  return (
    <li>
      <p>
        {clusterMatch ? (
          <>
            <strong className="career-resume-bullet-cluster">{clusterMatch[1]}</strong>{' '}
            {clusterMatch[2]}
          </>
        ) : (
          bullet.value
        )}
      </p>
      <div className="career-resume-bullet-meta">
        <EvidenceChip memoryId={bullet.memoryId} />
        {bullet.reviewFlags.map((flag) => (
          <span key={flag} className="career-resume-flag">
            <WarningCircle size={13} weight="fill" />
            {reviewFlagLabel(flag)}
          </span>
        ))}
        {onDetach ? (
          <button type="button" className="career-resume-detach" onClick={onDetach}>
            Убрать
          </button>
        ) : null}
      </div>
    </li>
  );
}
