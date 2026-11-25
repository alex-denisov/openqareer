import { useState } from 'react';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { isWorkTerm } from '../../../../../shared/vacancyWorkTerm';
import { Icon } from '../../kit';
import { fitRows, listedRows } from '../card/fitRows';
import { RequirementList } from '../card/RequirementList';
import { textBlocks } from '../card/textBlocks';
import { ownNoScoreReason } from './ownNoScore';

function coverageLabel(view: VacancyFitView, count: number): string {
  const coverage = view.result?.coverage;
  return coverage && coverage.total > 0
    ? `Требования: ${coverage.matched} из ${coverage.total} есть в профиле`
    : `Требования из текста вакансии · ${count}`;
}

export function OwnTextBody({ text }: { readonly text: string }) {
  return (
    <>
      {textBlocks(text).map((block, index) =>
        block.kind === 'h' ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>,
      )}
    </>
  );
}

export function OwnText({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="v4-box">
      <button
        className="v4-req-row"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Текст вакансии</span>
        <Icon name="down" className="v4-chev" />
      </button>
      {open ? (
        <div className="v4-reqs-open">
          <OwnTextBody text={text} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Без строк навыков: почему нет счёта, словами, и найденные требования, даже если ни одно не навык.
 * Со строками навыков причина стоит заголовком их рамки (OwnDetailBody).
 */
function NoScore({ view }: { view: VacancyFitView }) {
  const reason = ownNoScoreReason(view);
  if (!reason) return null;
  const others = view.requirements.filter((item) => !isWorkTerm(item));
  return (
    <div className={others.length > 0 ? 'v4-box v4-reqs-box' : 'v4-box'}>
      <p className="v4-req-row">{reason}</p>
      {others.length > 0 ? (
        <div className="v4-reqs-open">
          <ul className="v4-fd-l">
            {others.map((item) => (
              <li key={item.id}>
                <span className="v4-fd-r">{item.label?.trim() || item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

interface OwnRequirementsProps {
  readonly fit: VacancyFitView;
  /** v04c: строка «Требования: 3 из 5…» раскрывает список; в строке подборки он открыт сразу. */
  readonly folded?: boolean;
}

export function OwnRequirements({ fit, folded = false }: OwnRequirementsProps) {
  const [open, setOpen] = useState(!folded);
  const rows = fitRows(fit);
  if (rows.length === 0) return <NoScore view={fit} />;
  const label = ownNoScoreReason(fit) ?? coverageLabel(fit, rows.length);
  return (
    <div className="v4-box v4-reqs-box">
      {folded ? (
        <button
          className="v4-req-row"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{label}</span>
          <Icon name="down" className="v4-chev" />
        </button>
      ) : (
        <p className="v4-req-row">{label}</p>
      )}
      {open ? (
        <div className="v4-reqs-open">
          <RequirementList rows={listedRows(fit)} />
        </div>
      ) : null}
    </div>
  );
}
