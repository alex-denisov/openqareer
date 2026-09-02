import { CheckCircle, Info, Plugs, WarningCircle } from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import {
  conventionLines,
  evidenceStatementLabel,
  staleReasonLabel,
  unknownGroupLabel,
} from './resumeLabels';
import { orderUnknowns } from './resumeStudioModel';
import { resumeSourceCoverage, type ImportedSource } from './resumeSourceCoverage';
import { ResumeTargetVacanciesBlock } from './ResumeTargetVacanciesBlock';
import type {
  ResumeConventions,
  ResumeDocument,
  ResumeDraft,
  ResumeEvidenceFreshness,
  ResumeUnknown,
} from './resumeTypes';

interface ResumeControlRailProps {
  readonly freshness: ResumeEvidenceFreshness;
  readonly excludedEvidenceIds: readonly string[];
  readonly document: ResumeDocument;
  readonly draft: ResumeDraft;
  readonly memory?: readonly CandidateMemory[];
  readonly importedSource?: ImportedSource;
  /** The candidate has saved the document at least once since the import. */
  readonly documentEdited?: boolean;
}

/**
 * The rail answers one question: what stops this resume from being true and
 * usable. Nothing decorative lives here — every row is either work to do or a
 * rule the document already follows.
 */
export function ResumeControlRail({
  freshness,
  excludedEvidenceIds,
  document,
  draft,
  memory = [],
  importedSource,
  documentEdited = false,
}: ResumeControlRailProps) {
  const unknowns = orderUnknowns(document.unknowns);

  return (
    <aside
      className="career-resume-rail"
      aria-label="Контроль резюме: соответствие правилам, свежесть и пробелы"
    >
      <ResumeTargetVacanciesBlock />
      <ImportedSourceBlock
        source={importedSource}
        draft={draft}
        edited={documentEdited}
      />
      <FreshnessBlock freshness={freshness} memory={memory} />
      <UnknownsBlock unknowns={unknowns} />
      <ExcludedBlock memoryIds={excludedEvidenceIds} memory={memory} />
      <ConventionsBlock conventions={document.conventions} />
    </aside>
  );
}

/**
 * What the connected platform actually gave the document.
 *
 * The owner connected a real hh.ru account and saw an empty Resume Studio with
 * no explanation. Half of the emptiness was ours (B172 slices 1–2); the rest is
 * the source itself — that account has no work history on hh.ru at all. An
 * empty section with no source named reads as a broken product, so the block
 * names both halves and points at the manual way out (B172 slice 3).
 */
function ImportedSourceBlock({
  source,
  draft,
  edited,
}: {
  source?: ImportedSource;
  draft: ResumeDraft;
  edited: boolean;
}) {
  if (!source) return null;
  const { filled, empty } = resumeSourceCoverage(draft);
  return (
    <section className="career-resume-rail-block">
      <h3>
        <Plugs size={15} /> Что дал источник
      </h3>
      <p>
        Импорт из {source.label} от {importDate(source.importedAt)} · Фактов о вас:{' '}
        {source.factCount}
      </p>
      {filled.length > 0 ? (
        <ul className="career-resume-conventions" aria-label="Заполненные разделы">
          {filled.map((section) => (
            <li key={section.id}>
              {section.label}
              {section.count === null ? '' : ` — ${section.count}`}
            </li>
          ))}
        </ul>
      ) : null}
      {empty.length > 0 ? (
        <>
          <p>
            {edited ? 'Пусто' : 'В источнике не было'}:{' '}
            {empty.map((section) => section.label).join(', ')}.
          </p>
          <p>
            Добавьте их вручную — резюме не придумывает того, чего в источнике
            нет.
          </p>
        </>
      ) : null}
    </section>
  );
}

function importDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'последнего импорта';
  return parsed.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function FreshnessBlock({
  freshness,
  memory,
}: {
  freshness: ResumeEvidenceFreshness;
  memory: readonly CandidateMemory[];
}) {
  if (freshness.stale.length === 0) return null;
  return (
    <section className="career-resume-rail-block is-alert" role="alert">
      <h3>
        <WarningCircle size={16} weight="fill" /> Требует обновления ({freshness.stale.length})
      </h3>
      <p>
        Факты, на которых построено резюме, изменились в вашем профиле или были
        отозваны. Сохраните резюме заново, чтобы зафиксировать актуальные.
      </p>
      <ul className="career-resume-stale">
        {freshness.stale.map((item) => (
          <li key={item.memoryId}>
            <span className="career-resume-evidence-line">
              {evidenceStatementLabel(memory, item.memoryId, 'stale')}
            </span>
            <span>{item.reasons.map(staleReasonLabel).join(' · ')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UnknownsBlock({ unknowns }: { unknowns: readonly ResumeUnknown[] }) {
  return (
    <section className="career-resume-rail-block">
      <h3>Уточнить ({unknowns.length})</h3>
      {unknowns.length === 0 ? (
        <p className="career-resume-rail-ok">
          <CheckCircle size={16} /> Открытых пробелов нет.
        </p>
      ) : (
        <ul className="career-resume-unknowns">
          {unknowns.map((item) => (
            <li
              key={`${item.code}-${item.entryId ?? ''}-${item.memoryId ?? ''}`}
              className={item.blocking ? 'is-blocking' : ''}
            >
              <span className="career-resume-unknown-mark">
                {item.blocking ? 'блокирует' : 'уточнить'}
              </span>
              <span>{item.message}</span>
              <span className="career-resume-unknown-group">{unknownGroupLabel(item.code)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExcludedBlock({
  memoryIds,
  memory,
}: {
  memoryIds: readonly string[];
  memory: readonly CandidateMemory[];
}) {
  if (memoryIds.length === 0) return null;
  return (
    <section className="career-resume-rail-block">
      <h3>Не попало в документ ({memoryIds.length})</h3>
      <p>
        Эти записи не подтверждены как факт, помечены чувствительными или не
        имеют источника, поэтому движок их не проецирует.
      </p>
      <ul className="career-resume-excluded">
        {memoryIds.map((memoryId) => (
          <li key={memoryId}>
            <span className="career-resume-evidence-line">
              {evidenceStatementLabel(memory, memoryId, 'excluded')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConventionsBlock({ conventions }: { conventions: ResumeConventions }) {
  return (
    <section className="career-resume-rail-block">
      <h3>
        <Info size={15} /> Правила варианта
      </h3>
      <ul className="career-resume-conventions">
        {conventionLines(conventions).map((line) => (
          <li key={line}>{line}</li>
        ))}
        {conventions.packVersion ? (
          <li>
            Набор конвенций <code>{conventions.packVersion}</code>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
