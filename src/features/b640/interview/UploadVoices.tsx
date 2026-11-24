import { useEffect, useId, useRef, useState } from 'react';
import type { InterviewDebriefView } from '../../../../server/domain/interviewDebriefView';
import type { VoiceSummaryItem } from '../../../../server/domain/interviewVoices';
import { Button, Icon, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { useShell } from '../shell/ShellContext';
import {
  confirmVoices,
  saveInterviewerName,
  splitVoices,
  type DebriefData,
} from './data/debriefApi';

const POLL_MS = 5_000;
type Replace = (next: DebriefData) => void;

/** Пока файл расшифровывается — перечитать; расшифровка готова — один раз разделить голоса. */
export function useVoicesStep(data: DebriefData | null, reload: () => void, replace: Replace) {
  const recording = data?.debrief?.recording;
  const status = recording?.source === 'upload' ? recording.status : null;
  const voices = data?.debrief?.voices?.status ?? null;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'recording' && status !== 'transcribing') return undefined;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [status, reload]);
  useEffect(() => {
    if (!data || !recording || status !== 'ready' || voices !== 'none') return;
    if (asked.current === recording.id) return;
    asked.current = recording.id;
    void splitVoices(data.response.id)
      .then((debrief) => replace({ ...data, debrief }))
      .catch(() => undefined);
  }, [data, recording, status, voices, replace]);
}

function VoiceRow(props: {
  readonly item: VoiceSummaryItem;
  readonly title: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <li className="ir-voice">
      <div>
        <div className="row-title">{props.title}</div>
        <div className="row-sub">
          <span className="num">{props.item.sharePercent}&nbsp;%</span> речи · «{props.item.quote}»
        </div>
      </div>
      {props.children}
    </li>
  );
}

function YesNo(props: { readonly yes: boolean | null; readonly onChange: (yes: boolean) => void }) {
  return (
    <div className="ir-yn">
      <button
        className="chip"
        type="button"
        aria-pressed={props.yes === true}
        onClick={() => props.onChange(true)}
      >
        Да, это я
      </button>
      <button
        className="chip"
        type="button"
        aria-pressed={props.yes === false}
        onClick={() => props.onChange(false)}
      >
        Нет
      </button>
    </div>
  );
}

function NameField(props: { readonly value: string; readonly onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Имя собеседника</label>
      <input
        id={id}
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      />
    </div>
  );
}

function useConfirm(data: DebriefData, debrief: InterviewDebriefView) {
  const { navigate } = useShell();
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
  async function confirm(candidate: 1 | 2, name: string) {
    setState('saving');
    try {
      await confirmVoices(data.response.id, candidate);
      if (name.trim() !== (debrief.interviewerName ?? '')) {
        await saveInterviewerName(data.response.id, name.trim());
      }
      navigate(buildNodePath('i04', { responseId: data.response.id }));
    } catch {
      setState('failed');
    }
  }
  return { state, confirm };
}

function secondTitle(mineFirst: boolean | null): string {
  if (mineFirst === null) return 'Голос 2';
  return mineFirst ? 'Голос 2 — интервьюер' : 'Голос 2 — это вы';
}

/** I4c «Чей голос»: кандидат отмечает свой голос; имя собеседника — у второго голоса. */
export function VoicesBlock({ data }: { readonly data: DebriefData }) {
  const debrief = data.debrief!;
  const [first, second] = debrief.voices?.items ?? [];
  const [mineFirst, setMineFirst] = useState<boolean | null>(
    debrief.voices?.candidate ? debrief.voices.candidate === 1 : null,
  );
  const [name, setName] = useState(debrief.interviewerName ?? '');
  const { state, confirm } = useConfirm(data, debrief);
  if (!first || !second) return null;
  return (
    <section className="mod" aria-labelledby="ic-v">
      <h3 className="mod-title" id="ic-v">
        Чей голос
      </h3>
      <ul className="rows">
        <VoiceRow item={first} title="Голос 1 — это вы?">
          <YesNo yes={mineFirst} onChange={setMineFirst} />
          {mineFirst === false ? <NameField value={name} onChange={setName} /> : null}
        </VoiceRow>
        <VoiceRow item={second} title={secondTitle(mineFirst)}>
          {mineFirst ? <NameField value={name} onChange={setName} /> : null}
        </VoiceRow>
      </ul>
      {state === 'failed' ? (
        <StatusLine state="err" text="Голоса не сохранились. Попробуйте ещё раз." />
      ) : null}
      <div className="actions m-commit">
        <Button
          variant="primary"
          disabled={mineFirst === null || state === 'saving'}
          onClick={() => void confirm(mineFirst ? 1 : 2, name)}
        >
          <Icon name="check" />
          Подтвердить голоса
        </Button>
      </div>
    </section>
  );
}
