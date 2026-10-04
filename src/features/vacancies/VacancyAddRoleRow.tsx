import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';

/** Предел ролей кампании (B324): больше десяти подборка не различает. */
export const CAMPAIGN_ROLE_LIMIT = 10;

function useAddRole(onAddCustomRole: (title: string) => Promise<boolean>, isLimitReached: boolean) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed || isLimitReached || saving) return;
    setSaving(true);
    try {
      if (await onAddCustomRole(trimmed)) setTitle('');
    } finally {
      setSaving(false);
    }
  };
  return { title, setTitle, saving, add };
}

/**
 * Своя роль кампании в панели фильтров (B324). Сводка B338 показывает только
 * роли, у которых есть вакансии; добавить новую формулировку можно отсюда.
 */
export function VacancyAddRoleRow({
  roleCount,
  onAddCustomRole,
  inputRef,
}: {
  readonly roleCount: number;
  readonly onAddCustomRole: (title: string) => Promise<boolean>;
  readonly inputRef?: React.Ref<HTMLInputElement>;
}) {
  const isLimitReached = roleCount >= CAMPAIGN_ROLE_LIMIT;
  const { title, setTitle, saving, add } = useAddRole(onAddCustomRole, isLimitReached);
  return (
    <>
      <p className={`role-limit-note${isLimitReached ? ' is-warning' : ''}`}>
        {isLimitReached
          ? `Достигнут предел — ${CAMPAIGN_ROLE_LIMIT} из ${CAMPAIGN_ROLE_LIMIT} ролей. Уберите одну, чтобы добавить другую.`
          : `${roleCount} из ${CAMPAIGN_ROLE_LIMIT} ролей`}
      </p>
      <div className="add-role-row">
        <input
          ref={inputRef}
          className="add-role-input"
          type="text"
          placeholder="Своя формулировка роли…"
          aria-label="Добавить свою роль"
          disabled={isLimitReached || saving}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void add();
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={isLimitReached || !title.trim() || saving}
          onClick={() => void add()}
        >
          <Plus size={16} weight="bold" aria-hidden="true" />
          <span>Добавить роль</span>
        </button>
      </div>
    </>
  );
}
