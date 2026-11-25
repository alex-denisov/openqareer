import { useId, useState } from 'react';
import type { HhResumeItem } from '../../connections/hhSessionPoll';
import { Button, Dialog, ResultLine, StatusLine } from '../kit';
import { chooseHhResume, readHhResumeList, refreshHhProfile } from './hhResumeSession';
import {
  refreshLinkedInProfile,
  showLinkedInWindow,
  watchLinkedInNeedsPerson,
  type LinkedInRefreshOutcome,
} from './linkedinSession';
import { ErrorLine } from './parts';

export type HhRowState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'signin' }
  | { readonly kind: 'person' }
  | { readonly kind: 'captcha' }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'choose';
      readonly resumes: readonly HhResumeItem[];
      readonly selectedId: string | null;
    }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string; readonly retry: () => void };

type Flow = 'refresh' | 'change';

const FAILED: Record<Flow, string> = {
  refresh: 'Профиль из hh.ru не обновился',
  change: 'Резюме hh.ru не прочитались',
};

const READING = {
  hh: 'Читаем резюме на hh.ru…',
  linkedin: 'Читаем профиль в LinkedIn…',
} as const;

/** Вход в окне hh.ru до исхода (сбой окна — входа нет); код сессии грузится по нажатию. */
async function signInToHh(): Promise<boolean> {
  const desktop = await import('../apply/hh/hhDesktop');
  return desktop.signInToHh().catch(() => false);
}

async function showHhCaptcha(): Promise<void> {
  const desktop = await import('../apply/hh/hhDesktop');
  await desktop.showHhCaptcha().catch(() => false);
}

/** Фоновый импорт LinkedIn; сбой без своего текста — общий. */
async function linkedInOutcome(
  onPerson: (needed: boolean) => void,
): Promise<LinkedInRefreshOutcome> {
  const stop = await watchLinkedInNeedsPerson(onPerson).catch(() => () => undefined);
  return refreshLinkedInProfile()
    .catch(() => ({ ok: false, message: 'Профиль из LinkedIn не обновился' }))
    .finally(stop);
}

function outcomeState(outcome: LinkedInRefreshOutcome, retry: () => void): HhRowState {
  return outcome.ok
    ? { kind: 'done', text: outcome.message }
    : { kind: 'error', text: outcome.message, retry };
}

function failedState(flow: Flow, reason: unknown, retry: () => void): HhRowState {
  if (reason instanceof Error && reason.message === 'hh_captcha') return { kind: 'captcha' };
  return { kind: 'error', text: FAILED[flow], retry };
}

/** «Обновить сейчас» и «Сменить резюме» строки hh.ru (у LinkedIn — только «Обновить сейчас»): итог — строкой под ней. */
export function useHhRowActions(onRefreshed: () => void, platform: 'hh' | 'linkedin' = 'hh') {
  const [state, setState] = useState<HhRowState>({ kind: 'idle' });

  const close = () => setState({ kind: 'idle' });
  const leave = (open: () => Promise<void>) => () => {
    close();
    void open();
  };

  async function refreshLinkedIn() {
    setState({ kind: 'reading' });
    const outcome = await linkedInOutcome((needed) =>
      setState({ kind: needed ? 'person' : 'reading' }),
    );
    if (outcome.ok) onRefreshed();
    setState(outcomeState(outcome, () => void refreshLinkedIn()));
  }

  async function run(flow: Flow) {
    if (platform === 'linkedin') return refreshLinkedIn();
    setState({ kind: 'reading' });
    let signedIn = false;
    try {
      const list = await readHhResumeList();
      signedIn = list.kind !== 'signin';
      if (list.kind !== 'ready') {
        setState({ kind: list.kind });
        if (signedIn) onRefreshed();
        return;
      }
      if (flow === 'change') {
        setState({ kind: 'choose', resumes: list.resumes, selectedId: list.selectedId });
        onRefreshed();
        return;
      }
      await refreshHhProfile(list.resumes, list.selectedId);
      setState({ kind: 'done', text: 'Профиль обновлён из hh.ru' });
      onRefreshed();
    } catch (reason: unknown) {
      setState(failedState(flow, reason, () => void run(flow)));
      // Вход виден, хотя профиль не обновился: пометка «вход истёк» снята — строку перечитать.
      if (signedIn) onRefreshed();
    }
  }

  /** B704: вход заново на месте строки; после него данные hh.ru читаются сразу. */
  async function connect() {
    close();
    if (await signInToHh()) await run('refresh');
  }

  async function choose(resumes: readonly HhResumeItem[], chosen: HhResumeItem) {
    await chooseHhResume(resumes, chosen);
    setState({ kind: 'done', text: `Резюме для откликов: ${chosen.title}` });
  }

  return {
    state,
    platform,
    refresh: () => void run('refresh'),
    change: () => void run('change'),
    choose,
    connect: () => void connect(),
    signIn: () => void connect(),
    captcha: leave(showHhCaptcha),
    close,
  };
}

interface ChooserProps {
  readonly resumes: readonly HhResumeItem[];
  readonly selectedId: string | null;
  readonly onChoose: (chosen: HhResumeItem) => Promise<void>;
  readonly onClose: () => void;
}

/** B710: резюме hh.ru строками, как при отклике; выбранное — то, которым уходят отклики. */
function ResumeChooser({ resumes, selectedId, onChoose, onClose }: ChooserProps) {
  const name = useId();
  const [picked, setPicked] = useState(selectedId ?? resumes[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = resumes.find((resume) => resume.id === picked);
  async function confirm() {
    if (!chosen) return;
    setBusy(true);
    setFailed(false);
    try {
      await onChoose(chosen);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  const footer = (
    <Button variant="primary" busy={busy} disabled={!chosen} onClick={() => void confirm()}>
      Подтвердить
    </Button>
  );
  return (
    <Dialog open title="Резюме для откликов" onClose={onClose} footer={footer}>
      <ul className="hh2-picks" aria-label="Резюме на hh.ru">
        {resumes.map((resume) => (
          <li className="hh2-pick" key={resume.id}>
            <label className="vt-opt">
              <input
                type="radio"
                name={name}
                checked={picked === resume.id}
                onChange={() => setPicked(resume.id)}
              />
              <span className="vt-opt-t">
                <b>{resume.title}</b>
                {resume.updatedLabel ? (
                  <span className="hh2-sub"> · {resume.updatedLabel}</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {failed ? <ErrorLine text="Резюме не сохранилось" /> : null}
    </Dialog>
  );
}

/** Итог действия под строкой hh.ru. */
export function HhRowResult({ actions }: { readonly actions: ReturnType<typeof useHhRowActions> }) {
  const { state } = actions;
  switch (state.kind) {
    case 'reading':
      return <StatusLine state="wait" text={READING[actions.platform]} />;
    case 'signin': {
      const signIn = (
        <button className="res-act" type="button" onClick={actions.signIn}>
          Войти в hh.ru
        </button>
      );
      return <StatusLine state="err" text="Нужен вход в hh.ru" action={signIn} />;
    }
    case 'person': {
      const open = (
        <button className="res-act" type="button" onClick={() => void showLinkedInWindow()}>
          Открыть окно
        </button>
      );
      return <StatusLine state="err" text="Нужен вход в LinkedIn" action={open} />;
    }
    case 'captcha': {
      const open = (
        <button className="res-act" type="button" onClick={actions.captcha}>
          Открыть окно hh.ru
        </button>
      );
      return <StatusLine state="err" text="hh.ru просит пройти проверку" action={open} />;
    }
    case 'empty':
      return <StatusLine state="err" text="На hh.ru у вас нет резюме" />;
    case 'choose':
      return (
        <ResumeChooser
          resumes={state.resumes}
          selectedId={state.selectedId}
          onChoose={(chosen) => actions.choose(state.resumes, chosen)}
          onClose={actions.close}
        />
      );
    case 'done':
      return <ResultLine text={state.text} />;
    case 'error':
      return <ErrorLine text={state.text} onRetry={state.retry} />;
    default:
      return null;
  }
}
