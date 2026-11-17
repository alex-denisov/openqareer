import { useEffect, useState } from 'react';
import type {
  CandidateStatusPreview,
  CandidateStatusState,
  StatusChangeOption,
} from '../../../../shared/candidateStatus';
import { TARGET_PROFESSION_MAX_LENGTH } from '../../../../shared/candidateStatus';
import { ActionDock, Button, Icon, InfoTip, Link } from '../kit';
import { B640_HOME_PATH, buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import {
  changeStatus,
  getStatus,
  initialChoice,
  previewStatus,
  sameChoice,
  type StatusChoice,
  type StatusOptions,
} from './statusChoice';

const PREVIEW_DELAY_MS = 400;

type PreviewLoad =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly preview: CandidateStatusPreview }
  | { readonly state: 'error' };

/** «Что изменится» для выбранного статуса; набор профессии не шлёт запрос на каждую букву. */
function usePreview(choice: StatusChoice): PreviewLoad & { readonly retry: () => void } {
  const [load, setLoad] = useState<PreviewLoad>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { status, targetProfession } = choice;
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    const timer = setTimeout(() => {
      previewStatus({ status, targetProfession }, controller.signal).then(
        (preview) => {
          if (!controller.signal.aborted) setLoad({ state: 'ready', preview });
        },
        () => {
          if (!controller.signal.aborted) setLoad({ state: 'error' });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [status, targetProfession, attempt]);
  return { ...load, retry: () => setAttempt((value) => value + 1) };
}

interface PickProps {
  readonly state: CandidateStatusState;
  readonly choice: StatusChoice;
  readonly onPick: (choice: StatusChoice) => void;
}

function StatusPick({ state, choice, onPick }: PickProps) {
  return (
    <fieldset className="pick">
      <legend>
        Статус поиска
        <InfoTip label="Кто видит статус" text="Ваш статус видите только вы" />
      </legend>
      {state.statuses.map((option) => (
        <label key={option.id}>
          <input
            type="radio"
            name="status"
            value={option.id}
            checked={choice.status === option.id}
            onChange={() => onPick({ ...choice, status: option.id })}
          />
          <b>{option.label}</b>
          {option.id === state.current.status ? <span className="tag">сейчас</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

interface ChangesProps {
  readonly preview: CandidateStatusPreview;
  readonly options: StatusOptions;
  readonly onToggle: (option: StatusChangeOption, checked: boolean) => void;
}

function PreviewChanges({ preview, options, onToggle }: ChangesProps) {
  if (preview.unchanged) return null;
  return (
    <div className="preview">
      {preview.appears.length > 0 ? (
        <div className="change add">
          <h3>Появится</h3>
          <ul>
            {preview.appears.map((line) => (
              <li key={line}>
                <Icon name="plus" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.options.length > 0 ? (
        <fieldset className="optin">
          <legend className="vh">Что можно поменять</legend>
          <h3 aria-hidden="true">
            <Icon name="sliders" />
            Что можно поменять
          </h3>
          {preview.options.map((option) => (
            <label key={option.key} htmlFor={`st-opt-${option.key}`} aria-label={option.label}>
              <input
                id={`st-opt-${option.key}`}
                type="checkbox"
                name={option.key}
                checked={options[option.key] ?? option.checked}
                onChange={(event) => onToggle(option, event.target.checked)}
              />
              <span>
                <b>{option.label}</b>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

function ProfessionField({ choice, onPick }: Pick<PickProps, 'choice' | 'onPick'>) {
  if (choice.status !== 'changing_profession') return null;
  return (
    <div className="pf-f">
      <label htmlFor="st-profession">Новая профессия</label>
      <input
        id="st-profession"
        type="text"
        value={choice.targetProfession}
        maxLength={TARGET_PROFESSION_MAX_LENGTH}
        placeholder="Например: продакт-менеджер"
        onChange={(event) => onPick({ ...choice, targetProfession: event.target.value })}
      />
    </div>
  );
}

interface PreviewLeadProps extends Pick<PickProps, 'choice' | 'onPick'> {
  readonly preview: ReturnType<typeof usePreview>;
  readonly options: StatusOptions;
  readonly saving: boolean;
  readonly canSave: boolean;
  readonly onSave: (shown: CandidateStatusPreview) => void;
  readonly onToggle: ChangesProps['onToggle'];
}

function PreviewLead(props: PreviewLeadProps) {
  const { choice, preview, options, saving, canSave, onPick, onSave, onToggle } = props;
  const shown = preview.state === 'ready' ? preview.preview : null;
  return (
    <section className="lead" aria-labelledby="pv-title">
      <div className="eyebrow">
        <Icon name="swap" />
        Что изменится
      </div>
      <h2 className="mod-title" id="pv-title">
        {shown ? shown.title : 'Статус поиска'}
      </h2>
      <ProfessionField choice={choice} onPick={onPick} />
      {preview.state === 'loading' ? <BlockSkeleton label="Считаем, что изменится" /> : null}
      {preview.state === 'error' ? (
        <BlockError text="Не удалось показать, что изменится." onRetry={preview.retry} />
      ) : null}
      {shown && canSave ? (
        <ActionDock
          kind="commit"
          primary={
            <Button variant="primary" icon="swap" busy={saving} onClick={() => onSave(shown)}>
              Сменить статус
            </Button>
          }
        />
      ) : null}
      {shown ? <PreviewChanges preview={shown} options={options} onToggle={onToggle} /> : null}
    </section>
  );
}

function resolvedOptions(preview: CandidateStatusPreview, picked: StatusOptions): StatusOptions {
  return Object.fromEntries(
    preview.options.map((option) => [option.key, picked[option.key] ?? option.checked]),
  );
}

function StatusHistoryLink() {
  return (
    <section className="mod" aria-labelledby="hist-title">
      <h3 className="mod-title" id="hist-title">
        История статуса
      </h3>
      <Link className="row-act" to={buildNodePath('p10')}>
        <Icon name="clock" />
        История изменений
      </Link>
    </section>
  );
}

/** Выбор на экране и его сохранение: после смены — на «Сегодня», там «Вернуть прежний». */
function useStatusChange(state: CandidateStatusState, search: string) {
  const { navigate } = useShell();
  const [choice, setChoice] = useState<StatusChoice>(() => initialChoice(search, state));
  const [options, setOptions] = useState<StatusOptions>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function pick(next: StatusChoice) {
    if (next.status !== choice.status) setOptions({});
    setFailed(false);
    setChoice(next);
  }

  async function save(shown: CandidateStatusPreview) {
    setSaving(true);
    setFailed(false);
    try {
      await changeStatus(choice, resolvedOptions(shown, options));
      navigate(B640_HOME_PATH);
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return { choice, options, saving, failed, pick, save, setOptions };
}

function StatusChoice({
  state,
  search,
}: {
  readonly state: CandidateStatusState;
  readonly search: string;
}) {
  const { choice, options, saving, failed, pick, save, setOptions } = useStatusChange(
    state,
    search,
  );
  const preview = usePreview(choice);
  const unchanged = sameChoice(choice, state);

  return (
    <>
      {failed ? (
        <div className="col-wide">
          <p className="li-err" role="alert">
            <Icon name="warn" />
            Статус не сохранился
          </p>
        </div>
      ) : null}
      <div className="col">
        <StatusPick state={state} choice={choice} onPick={pick} />
      </div>
      <div className="col">
        <PreviewLead
          choice={choice}
          preview={preview}
          options={options}
          saving={saving}
          canSave={!unchanged}
          onPick={pick}
          onSave={(shown) => void save(shown)}
          onToggle={(option, checked) => setOptions({ ...options, [option.key]: checked })}
        />
      </div>
      <div className="col">
        <StatusHistoryLink />
      </div>
    </>
  );
}

/** s02 «Статус»: выбор из пяти статусов, «Что изменится» и смена (B665). */
export function StatusChoiceScreen({ node }: { readonly node: B640Node }) {
  const { search } = useShell();
  const status = useLoad(getStatus);
  return (
    <div className="page two is-pick" data-b640-node={node.code} data-b640-section={node.section}>
      {status.state === 'loading' ? (
        <div className="col">
          <BlockSkeleton label="Загружаем статус" rows={5} />
        </div>
      ) : null}
      {status.state === 'error' ? (
        <div className="col">
          <BlockError text="Не удалось загрузить статус." onRetry={status.retry} />
        </div>
      ) : null}
      {status.state === 'ready' ? <StatusChoice state={status.data} search={search} /> : null}
    </div>
  );
}
