import { useState } from 'react';
import { Dialog } from '../kit/Dialog';
import { Icon } from '../kit/Icon';
import { requestAccountDeletion, restoreAccount, type AccountDeletion } from './accountDeletionApi';
import { ErrorLine } from './parts';

/** «19 декабря» — день, когда данные сотрутся. */
function deadline(purgeAfter: string): string {
  return new Date(purgeAfter).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

interface AskProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

/** n05b: что будет после удаления и что его можно отменить. */
function DeleteDialog({ open, busy, failed, onDelete, onClose }: AskProps) {
  return (
    <Dialog open={open} title="Удалить аккаунт?" onClose={onClose}>
      <ul className="c5-list">
        <li>Профиль, отклики и дневник сотрутся через 30 дней.</li>
        <li>Автоотклики и публикации по расписанию остановятся сразу.</li>
        <li>До конца этого срока аккаунт можно вернуть.</li>
      </ul>
      {failed ? <ErrorLine text="Аккаунт не удалён" /> : null}
      <div className="actions">
        <button
          className="btn is-danger"
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={onDelete}
        >
          <Icon name="trash" />
          Удалить аккаунт
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Оставить
        </button>
      </div>
    </Dialog>
  );
}

/** Состояние удаления: запрос, возврат, ожидание и ошибка на месте. */
function useAccountDeletion(initial: AccountDeletion | null) {
  const [deletion, setDeletion] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(action: () => Promise<AccountDeletion | null>) {
    setBusy(true);
    setFailed(false);
    try {
      setDeletion(await action());
      setAsking(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return {
    deletion,
    asking,
    busy,
    failed,
    ask: () => {
      setFailed(false);
      setAsking(true);
    },
    close: () => setAsking(false),
    remove: () => void act(requestAccountDeletion),
    restore: () =>
      void act(async () => {
        await restoreAccount();
        return null;
      }),
  };
}

/**
 * «Удаление аккаунта» (B689): удаление запрашивается после окна n05b, данные
 * стираются через 30 дней; до того в строке — срок и «Вернуть аккаунт».
 */
export function AccountDeletionGroup({ initial }: { readonly initial: AccountDeletion | null }) {
  const state = useAccountDeletion(initial);
  const { deletion } = state;
  return (
    <section className="set-group" aria-label="Удаление аккаунта">
      <h3 className="set-h">Удаление аккаунта</h3>
      <ul className="set-list">
        <li className="set-row">
          <div className="set-l">
            <span className="set-t">
              {deletion ? `Аккаунт удалится ${deadline(deletion.purgeAfter)}` : 'Удалить аккаунт'}
            </span>
            {state.failed && !state.asking ? <ErrorLine text="Не получилось" /> : null}
          </div>
          <div className="set-r">
            {deletion ? (
              <button className="btn is-sm" type="button" disabled={state.busy} onClick={state.restore}>
                Вернуть аккаунт
              </button>
            ) : (
              <button className="btn is-sm is-danger" type="button" aria-label="Удалить аккаунт" onClick={state.ask}>
                Удалить
              </button>
            )}
          </div>
        </li>
      </ul>
      <DeleteDialog
        open={state.asking}
        busy={state.busy}
        failed={state.failed}
        onDelete={state.remove}
        onClose={state.close}
      />
    </section>
  );
}
