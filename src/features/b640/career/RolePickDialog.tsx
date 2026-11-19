import type { CampaignMetaView } from '../../coach/matchedVacancyApi';
import { Button, Dialog, Icon, Link, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import type { RoleRow } from './rolesModel';
import { roleKey, searchButtonLabel, useRolePick, type RolePick } from './useRolePick';

export interface RolePickDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly rows: readonly RoleRow[];
  readonly campaign: CampaignMetaView;
}

export const PICK_ERROR = 'Роли не сохранились. Отметки остались — попробуйте ещё раз.';

function RoleOptions({
  rows,
  pick,
}: {
  readonly rows: readonly RoleRow[];
  readonly pick: RolePick;
}) {
  return (
    <fieldset className="rs-set">
      <legend className="vh">Отметьте роли</legend>
      <ul className="vt-opts">
        {rows.map((row) => (
          <li key={row.id}>
            <label className="vt-opt">
              <input
                type="checkbox"
                checked={pick.picked.has(roleKey(row.title))}
                onChange={() => pick.toggle(row.title)}
              />
              <span className="vt-opt-t">
                {row.title}
                {row.wage ? <small className="rs-sub num">{row.wage}</small> : null}
              </span>
              <span className="vt-opt-n num">
                {row.vacancies ?? '—'}
                <span className="vh"> вакансий</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** S9c «Роли поиска»: отметить роли, сохранить и перейти к вакансиям. */
export function RolePickDialog({ open, onClose, rows, campaign }: RolePickDialogProps) {
  const initial = rows.filter((row) => row.origin === 'search').map((row) => row.title);
  const pick = useRolePick(rows, initial, campaign);
  const footer = (
    <>
      <Button
        variant="primary"
        icon="check"
        busy={pick.state === 'busy'}
        disabled={pick.selected.length === 0}
        onClick={() => void pick.search()}
      >
        {searchButtonLabel(pick.selected)}
      </Button>
      <Button variant="quiet" onClick={onClose}>
        Отмена
      </Button>
    </>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Роли поиска" footer={footer} className="rs-dlg">
      <RoleOptions rows={rows} pick={pick} />
      {pick.state === 'error' ? <StatusLine state="err" text={PICK_ERROR} /> : null}
      <Link className="row-act" to={buildNodePath('s10')}>
        <Icon name="scales" />
        Сравнить роли
      </Link>
    </Dialog>
  );
}
