import { useId, useState } from 'react';
import {
  enableCandidateAutomation,
  pauseCandidateAutomation,
  saveCandidateAutomationSchedule,
  updateCandidateAutomationRules,
  type CandidateAutomationSnapshot,
} from '../../automation/automationApi';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, Dialog, Icon, Link, SegControl, StatusLine } from '../kit';
import { DateInput } from '../kit/DateInput';
import { buildNodePath } from '../routes';
import {
  DAY_LIMIT_MAX,
  PLATFORM_LABELS,
  consentsToGrant,
  pauseDays,
  splitDayLimit,
  type AutomationPlatform,
  type AutomationView,
} from './model/automationView';

type LetterMode = 'automatic' | 'approval_required';

const LETTER_OPTIONS = [
  { value: 'automatic', label: 'Отправлять сразу' },
  { value: 'approval_required', label: 'Сначала мне на одобрение' },
] as const;

const PLATFORMS: readonly AutomationPlatform[] = ['hh', 'linkedin'];
const TITLE = 'Настроить автоотклики';

export interface AutomationSheetProps {
  readonly open: boolean;
  readonly snapshot: CandidateAutomationSnapshot;
  readonly view: AutomationView;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  /** Сохранение оборвалось на середине: часть настроек уже на сервере. */
  readonly onFailed: () => void;
}

export interface AutomationDraft {
  readonly roles: readonly string[];
  readonly platforms: readonly AutomationPlatform[];
  readonly dayLimit: string;
  readonly letter: LetterMode;
  readonly pauseUntil: string;
  /** Отметка согласия; нужна, только пока согласий нет (B645). */
  readonly consent: boolean;
}

/** Что не так в настройках; null — можно сохранять. */
export function validateAutomationDraft(
  draft: AutomationDraft,
  hasRoles: boolean,
  needsConsent = false,
): string | null {
  if (hasRoles && draft.roles.length === 0) return 'Оставьте хотя бы одну роль.';
  if (draft.platforms.length === 0) return 'Выберите хотя бы одну площадку.';
  const limit = Number(draft.dayLimit);
  if (!Number.isInteger(limit) || limit < draft.platforms.length || limit > DAY_LIMIT_MAX) {
    return `Лимит в день — от ${draft.platforms.length} до ${DAY_LIMIT_MAX}.`;
  }
  if (draft.pauseUntil && pauseDays(draft.pauseUntil) === null) {
    return 'Дата паузы — с завтрашнего дня и не дальше года.';
  }
  if (needsConsent && !draft.consent) return 'Отметьте согласие, чтобы включить автоотклики.';
  return null;
}

async function saveAutomation(
  draft: AutomationDraft,
  snapshot: CandidateAutomationSnapshot,
  view: AutomationView,
): Promise<void> {
  const { settings, schedule } = snapshot;
  await updateCandidateAutomationRules({
    ...settings.rules,
    roles: [...draft.roles],
    platforms: [...draft.platforms],
  });
  await saveCandidateAutomationSchedule({
    ...schedule,
    dailyLimits: splitDayLimit(Number(draft.dayLimit), draft.platforms, schedule.dailyLimits),
  });
  if (view.canSendAtOnce && settings.enabled && draft.letter !== settings.mode) {
    await enableCandidateAutomation({ mode: draft.letter, consentKeys: view.consentKeys });
  }
  const grant = consentsToGrant(view, draft.consent);
  if (grant) await enableCandidateAutomation({ mode: 'approval_required', consentKeys: grant });
  const days = draft.pauseUntil ? pauseDays(draft.pauseUntil) : null;
  if (days !== null) await pauseCandidateAutomation(days);
}

interface ChecksProps<T extends string> {
  readonly idPrefix: string;
  readonly legend: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly selected: readonly T[];
  readonly onChange: (selected: readonly T[]) => void;
}

function CheckList<T extends string>({ idPrefix, legend, options, selected, onChange }: ChecksProps<T>) {
  return (
    <fieldset className="au3-f">
      <legend className="au3-l">{legend}</legend>
      <ul className="vt-opts">
        {options.map((option, index) => (
          <li key={option.value}>
            <label className="vt-opt" htmlFor={`${idPrefix}-${index}`}>
              <input
                type="checkbox"
                id={`${idPrefix}-${index}`}
                checked={selected.includes(option.value)}
                onChange={(event) => {
                  const on = event.currentTarget.checked;
                  onChange(
                    options
                      .map((item) => item.value)
                      .filter((value) => (value === option.value ? on : selected.includes(value))),
                  );
                }}
              />
              <span className="vt-opt-t">{option.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

interface FieldsProps {
  readonly id: string;
  readonly draft: AutomationDraft;
  readonly setDraft: (draft: AutomationDraft) => void;
  readonly roles: readonly string[];
  readonly canSendAtOnce: boolean;
}

function DayLimitField({ id, draft, setDraft }: Pick<FieldsProps, 'id' | 'draft' | 'setDraft'>) {
  return (
    <div className="au3-f">
      <label className="au3-l" htmlFor={`${id}-day`}>
        Лимит в день
      </label>
      <input
        className="au3-in num"
        id={`${id}-day`}
        type="number"
        inputMode="numeric"
        min={1}
        max={DAY_LIMIT_MAX}
        value={draft.dayLimit}
        onChange={(event) => setDraft({ ...draft, dayLimit: event.currentTarget.value })}
      />
    </div>
  );
}

function SheetFields({ id, draft, setDraft, roles, canSendAtOnce }: FieldsProps) {
  return (
    <>
      {roles.length > 0 ? (
        <CheckList
          idPrefix={`${id}-r`}
          legend="Роли"
          options={roles.map((role) => ({ value: role, label: role }))}
          selected={draft.roles}
          onChange={(next) => setDraft({ ...draft, roles: next })}
        />
      ) : null}
      <CheckList
        idPrefix={`${id}-s`}
        legend="Площадки"
        options={PLATFORMS.map((platform) => ({ value: platform, label: PLATFORM_LABELS[platform] }))}
        selected={draft.platforms}
        onChange={(next) => setDraft({ ...draft, platforms: next })}
      />
      <DayLimitField id={id} draft={draft} setDraft={setDraft} />
      {canSendAtOnce ? (
        <fieldset className="au3-f">
          <legend className="au3-l">Письмо</legend>
          <SegControl
            label="Письмо"
            name={`${id}-let`}
            value={draft.letter}
            options={LETTER_OPTIONS}
            onChange={(letter) => setDraft({ ...draft, letter })}
          />
        </fieldset>
      ) : null}
      <div className="au3-f">
        <label className="au3-l" htmlFor={`${id}-pause`}>
          Пауза до <span className="au3-opt">необязательно</span>
        </label>
        <DateInput
          className="au3-in"
          id={`${id}-pause`}
          value={draft.pauseUntil}
          onChange={(pauseUntil) => setDraft({ ...draft, pauseUntil })}
        />
      </div>
    </>
  );
}

/** Лист на тарифе без автооткликов (A4f). */
function PlanSheet({ open, onClose }: Pick<AutomationSheetProps, 'open' | 'onClose'>) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={TITLE}
      footer={
        <>
          <Link className="btn is-primary" to={buildNodePath('t03')}>
            <Icon name="wallet" />
            Перейти на Pro
          </Link>
          <Button variant="quiet" icon="close" onClick={onClose}>
            Отмена
          </Button>
        </>
      }
    >
      <p className="au3-free">
        <b>Автоотклики на Pro</b>
      </p>
    </Dialog>
  );
}

interface FooterProps {
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onClose: () => void;
}

function SaveFooter({ busy, onSave, onClose }: FooterProps) {
  return (
    <>
      <Button variant="primary" icon="check" busy={busy} onClick={onSave}>
        Сохранить
      </Button>
      <Button variant="quiet" icon="close" onClick={onClose}>
        Отмена
      </Button>
    </>
  );
}

/** Согласие на автоотклики: без него включить нельзя (B645). */
function ConsentCheck({ id, draft, setDraft }: Pick<FieldsProps, 'id' | 'draft' | 'setDraft'>) {
  return (
    <label className="vt-opt" htmlFor={`${id}-consent`}>
      <input
        type="checkbox"
        id={`${id}-consent`}
        checked={draft.consent}
        onChange={(event) => setDraft({ ...draft, consent: event.currentTarget.checked })}
      />
      <span className="vt-opt-t">
        Разрешаю готовить отклики, отправлять их после моего одобрения и присылать уведомления
      </span>
    </label>
  );
}

function RulesSheet({ open, snapshot, view, onClose, onSaved, onFailed }: AutomationSheetProps) {
  const id = useId();
  const { settings } = snapshot;
  const [draft, setDraft] = useState<AutomationDraft>(() => ({
    roles: settings.rules.roles,
    platforms: settings.rules.platforms,
    dayLimit: String(view.dayLimit || settings.rules.platforms.length),
    letter: settings.mode === 'automatic' ? 'automatic' : 'approval_required',
    pauseUntil: '',
    consent: false,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const problem = validateAutomationDraft(draft, settings.rules.roles.length > 0, !view.consented);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await saveAutomation(draft, snapshot, view);
      onSaved();
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Не получилось сохранить. Повторите.'));
      onFailed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={TITLE}
      footer={<SaveFooter busy={busy} onSave={() => void save()} onClose={onClose} />}
    >
      <SheetFields
        id={id}
        draft={draft}
        setDraft={setDraft}
        roles={settings.rules.roles}
        canSendAtOnce={view.canSendAtOnce}
      />
      {view.consented ? null : <ConsentCheck id={id} draft={draft} setDraft={setDraft} />}
      {error ? <StatusLine state="err" text={error} /> : null}
    </Dialog>
  );
}

/** Лист «Настроить автоотклики» (A4e) и его вид на тарифе без автооткликов (A4f). */
export function AutomationSheet(props: AutomationSheetProps) {
  return props.view.needsPlan ? (
    <PlanSheet open={props.open} onClose={props.onClose} />
  ) : (
    <RulesSheet {...props} />
  );
}
