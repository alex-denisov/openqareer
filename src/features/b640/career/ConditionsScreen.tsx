import { useState } from 'react';
import type { SearchConditionsDraft } from '../../career-map/careerScreenTypes';
import { InfoTip, ResultLine, StatusLine } from '../kit';
import type { B640Node } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { pageAttrs } from './careerPaths';
import { ConditionEditor } from './ConditionEditors';
import { loadConditions, saveConditions, type ConditionsData } from './conditionsApi';
import { conditionRows, SAVED_TEXT, type ConditionField } from './conditionsModel';

const STATE = 'c10';
/** Макет c10 — страница настроек 640 по центру (`data-template="settings"`), а не шаблон объекта «Ролей». */
const SETTINGS_PAGE = { rootData: { template: 'settings' } } as const;
const TIP =
  'Условия фильтруют подборку по всем ролям. Пустое условие поиск не ограничивает. Каждое значение правится отдельно.';

type SaveState = 'idle' | 'busy' | 'error';

interface Saved {
  readonly field: ConditionField;
  readonly before: SearchConditionsDraft;
}

function useConditionsEdit(initial: ConditionsData) {
  const [data, setData] = useState(initial);
  const [editing, setEditing] = useState<ConditionField | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const [saved, setSaved] = useState<Saved | null>(null);
  const [undo, setUndo] = useState<'idle' | 'busy' | 'error'>('idle');

  const save = async (next: SearchConditionsDraft) => {
    if (!editing) return;
    setState('busy');
    try {
      const before = data.conditions;
      setData(await saveConditions(data, next));
      setSaved({ field: editing, before });
      setEditing(null);
      setState('idle');
    } catch {
      setState('error');
    }
  };

  const revert = async () => {
    if (!saved || undo === 'busy') return;
    setUndo('busy');
    try {
      setData(await saveConditions(data, saved.before));
      setSaved(null);
      setUndo('idle');
    } catch {
      setUndo('error');
    }
  };

  const open = (field: ConditionField | null) => {
    setEditing(field);
    setState('idle');
    setSaved(null);
    setUndo('idle');
  };

  return { data, editing, state, saved, undo, save, revert, open };
}

function ConditionsList({ initial }: { readonly initial: ConditionsData }) {
  const edit = useConditionsEdit(initial);
  return (
    <section className="lead cc" aria-labelledby="cc-title">
      <h2 className="lead-title" id="cc-title">
        Условия и география
        <InfoTip label="Пояснение" text={TIP} />
      </h2>
      <ul className="cc-rows" aria-label="Условия поиска">
        {conditionRows(edit.data.conditions).map((row) => (
          <li className={edit.editing === row.field ? 'cc-row is-next' : 'cc-row'} key={row.field}>
            <span className="cc-l">{row.label}</span>
            <span className={row.value === null ? 'cc-v dim' : 'cc-v num'}>
              {row.value ?? 'не указано'}
            </span>
            {edit.editing === row.field ? (
              <ConditionEditor
                field={row.field}
                value={edit.data.conditions}
                busy={edit.state === 'busy'}
                failed={edit.state === 'error'}
                onSave={(next) => void edit.save(next)}
                onCancel={() => edit.open(null)}
              />
            ) : (
              <button
                className="row-act"
                type="button"
                aria-label={`${row.action}: ${row.label}`}
                onClick={() => edit.open(row.field)}
              >
                {row.action}
              </button>
            )}
          </li>
        ))}
      </ul>
      {edit.saved && edit.undo !== 'busy' ? (
        <ResultLine text={SAVED_TEXT} onUndo={() => void edit.revert()} />
      ) : null}
      {edit.undo === 'busy' ? <StatusLine state="wait" text="Возвращаем прежнее…" /> : null}
      {edit.undo === 'error' ? (
        <StatusLine state="err" text="Не удалось вернуть прежнее. Попробуйте ещё раз." />
      ) : null}
    </section>
  );
}

/** C10 «Условия и география»: состояние вкладки «Роли», каждое условие правится на месте. */
export function ConditionsScreen({ node }: { readonly node: B640Node }) {
  useScreenChrome(SETTINGS_PAGE);
  const load = useLoad(loadConditions);
  return (
    <div className="page two" {...pageAttrs(node, STATE)}>
      <div className="col">
        {load.state === 'loading' ? (
          <BlockSkeleton label="Загружаем условия" rows={4} />
        ) : load.state === 'error' ? (
          <BlockError text="Не удалось загрузить условия поиска." onRetry={load.retry} />
        ) : (
          <ConditionsList initial={load.data} />
        )}
      </div>
    </div>
  );
}
