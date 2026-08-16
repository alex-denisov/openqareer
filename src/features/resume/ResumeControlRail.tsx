import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react';
import { conventionLines, staleReasonLabel } from './resumeLabels';
import { orderUnknowns } from './resumeStudioModel';
import type {
  ResumeConventions,
  ResumeDocument,
  ResumeEvidenceFreshness,
  ResumeUnknown,
} from './resumeTypes';

interface ResumeControlRailProps {
  readonly freshness: ResumeEvidenceFreshness;
  readonly excludedEvidenceIds: readonly string[];
  readonly document: ResumeDocument;
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
}: ResumeControlRailProps) {
  return (
    <aside className="career-resume-rail" aria-label="Что уточнить">
      <StaleEvidenceBlock freshness={freshness} />
      <UnknownsBlock unknowns={orderUnknowns(document.unknowns)} />
      <ExcludedBlock memoryIds={excludedEvidenceIds} />
      <ConventionsBlock conventions={document.conventions} />
    </aside>
  );
}

function StaleEvidenceBlock({ freshness }: { freshness: ResumeEvidenceFreshness }) {
  if (freshness.stale.length === 0) return null;
  return (
    <section className="career-resume-rail-block is-alert" role="alert">
      <h3>
        <WarningCircle size={16} weight="fill" /> Доказательство больше не
        подтверждено
      </h3>
      <p>
        Эти факты были одобрены при сохранении, но в досье они изменились или
        отозваны. Сохраните резюме заново, чтобы зафиксировать актуальные.
      </p>
      <ul className="career-resume-stale">
        {freshness.stale.map((item) => (
          <li key={item.memoryId}>
            <code>{item.memoryId}</code>
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
              <code>{item.code}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExcludedBlock({ memoryIds }: { memoryIds: readonly string[] }) {
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
            <code>{memoryId}</code>
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
