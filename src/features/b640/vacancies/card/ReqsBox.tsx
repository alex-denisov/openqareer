import { useState } from 'react';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { Icon } from '../../kit';
import { fitRows, requirementsLabel } from './fitRows';
import { RequirementList } from './RequirementList';

export interface ReqsBoxProps {
  readonly view: VacancyFitView | undefined;
}

/** «Требования: N из M есть в профиле»; раскрывается на месте тем же списком. */
export function ReqsBox({ view }: ReqsBoxProps) {
  const [open, setOpen] = useState(false);
  const rows = fitRows(view);
  if (rows.length === 0) return null;
  return (
    <div className="v4-box v4-reqs-box">
      <button
        className="v4-req-row"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{requirementsLabel(view)}</span>
        <Icon name="down" className="v4-chev" />
      </button>
      {open ? (
        <div className="v4-reqs-open">
          <RequirementList rows={rows} />
        </div>
      ) : null}
    </div>
  );
}
