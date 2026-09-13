import { useEffect, useMemo, useState } from 'react';
import { saveHhCrawlFilter, type HhCrawlFilter } from './adminApi';

/**
 * Фильтр веера обхода hh.ru (B214).
 *
 * Владелец выбирает роли множественным выбором из полного справочника
 * площадки — 27 категорий, 304 роли. По умолчанию выбрана категория
 * «Информационные технологии».
 *
 * Экран ничего не досчитывает за площадку: пока фильтр не загружен, чисел
 * здесь нет вовсе. «0 из 0» на месте незагруженного списка — то самое
 * выдуманное число, за которое уже приходилось чинить админку (PRB-024).
 */

interface HhCrawlFilterViewProps {
  readonly filter: HhCrawlFilter | null;
  readonly onSaved?: (selectedRoleIds: readonly string[]) => void;
}

function formatSweep(lastFullSweepAt: string | null): string {
  if (!lastFullSweepAt) return 'Полного обхода ещё не было';
  const parsed = new Date(lastFullSweepAt);
  if (Number.isNaN(parsed.getTime())) return 'Время последнего обхода неизвестно';
  return `Последний полный обход: ${parsed.toLocaleString('ru-RU')}`;
}

interface CategoryBlockProps {
  readonly category: HhCrawlFilter['categories'][number];
  readonly selectedSet: ReadonlySet<string>;
  readonly onToggleRole: (roleId: string) => void;
  readonly onToggleCategory: (categoryId: string) => void;
}

function CategoryBlock({
  category,
  selectedSet,
  onToggleRole,
  onToggleCategory,
}: CategoryBlockProps) {
  const chosen = category.roles.filter((role) => selectedSet.has(role.id)).length;
  return (
    <details open={chosen > 0}>
      <summary>
        <button type="button" onClick={() => onToggleCategory(category.id)}>
          {category.name} ({chosen}/{category.roles.length})
        </button>
      </summary>
      <ul>
        {category.roles.map((role) => (
          <li key={role.id}>
            <label>
              <input
                type="checkbox"
                value={role.id}
                checked={selectedSet.has(role.id)}
                onChange={() => onToggleRole(role.id)}
              />
              {role.name}
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Выбор владельца и его сохранение: состояние экрана отдельно от разметки. */
function useRoleSelection(
  filter: HhCrawlFilter | null,
  onSaved?: HhCrawlFilterViewProps['onSaved'],
) {
  const [selected, setSelected] = useState<readonly string[]>(filter?.selectedRoleIds ?? []);
  const [periodDays, setPeriodDays] = useState(filter?.searchPeriodDays ?? 30);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!filter) return;
    setSelected(filter.selectedRoleIds);
    setPeriodDays(filter.searchPeriodDays);
  }, [filter]);

  const toggleRole = (roleId: string) => {
    setSelected((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  };

  const toggleCategory = (categoryId: string) => {
    const category = filter?.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const ids = category.roles.map((role) => role.id);
    const allSelected = ids.every((id) => selected.includes(id));
    setSelected((current) =>
      allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])],
    );
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveHhCrawlFilter({ roleIds: selected, searchPeriodDays: periodDays });
      // Роль, которой площадка не знает, называется вслух, а не исчезает молча.
      setMessage(
        saved.ignoredRoleIds.length > 0
          ? `Сохранено. Площадка не знает ролей: ${saved.ignoredRoleIds.join(', ')}`
          : 'Сохранено',
      );
      setSelected(saved.selectedRoleIds);
      onSaved?.(saved.selectedRoleIds);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Сохранить не удалось');
    } finally {
      setSaving(false);
    }
  };

  return { selected, periodDays, setPeriodDays, saving, message, toggleRole, toggleCategory, save };
}

function FilterFooter({
  saving,
  empty,
  message,
  onSave,
}: {
  readonly saving: boolean;
  readonly empty: boolean;
  readonly message: string | null;
  readonly onSave: () => void;
}) {
  return (
    <footer className="hh-crawl-filter__foot">
      <button type="button" onClick={onSave} disabled={saving || empty}>
        {saving ? 'Сохраняем…' : 'Сохранить фильтр'}
      </button>
      {empty && (
        <span className="admin-muted">
          Выберите хотя бы одну роль — пустой набор остановил бы обход целиком.
        </span>
      )}
      {message && <span className="admin-muted">{message}</span>}
    </footer>
  );
}

export function HhCrawlFilterView({ filter, onSaved }: HhCrawlFilterViewProps) {
  const { selected, periodDays, setPeriodDays, saving, message, toggleRole, toggleCategory, save } =
    useRoleSelection(filter, onSaved);

  const totalRoles = useMemo(
    () => filter?.categories.reduce((sum, category) => sum + category.roles.length, 0) ?? 0,
    [filter],
  );

  if (!filter) {
    return (
      <section className="admin-panel">
        <h3>Фильтр обхода hh.ru</h3>
        <p className="admin-muted">Загружаем справочник ролей площадки…</p>
      </section>
    );
  }

  const selectedSet = new Set(selected);

  return (
    <section className="admin-panel hh-crawl-filter">
      <header className="hh-crawl-filter__head">
        <h3>Фильтр обхода hh.ru</h3>
        <p className="admin-muted">
          Выбрано ролей: {selected.length} из {totalRoles}. {formatSweep(filter.lastFullSweepAt)}
        </p>
      </header>

      <label className="hh-crawl-filter__period">
        Собирать вакансии, опубликованные за последние
        <input
          type="number"
          min={1}
          max={30}
          value={periodDays}
          onChange={(event) => setPeriodDays(Number(event.target.value))}
        />
        дней
      </label>

      <div className="hh-crawl-filter__categories">
        {filter.categories.map((category) => (
          <CategoryBlock
            key={category.id}
            category={category}
            selectedSet={selectedSet}
            onToggleRole={toggleRole}
            onToggleCategory={toggleCategory}
          />
        ))}
      </div>

      <FilterFooter saving={saving} empty={selected.length === 0} message={message} onSave={save} />
    </section>
  );
}
