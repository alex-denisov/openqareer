// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import type { VoiceInput } from '../voice/useVoiceInput';
import { answerModeOf, useFinishAfterVoice, VoiceAnswer } from './PracticeAnswerInput';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function voice(over: Partial<VoiceInput> = {}): VoiceInput {
  return {
    supported: true,
    recording: false,
    settling: false,
    denied: false,
    failure: null,
    start: vi.fn(),
    stop: vi.fn(),
    ...over,
  };
}

function render(input: VoiceInput, text = 'Шлюз API') {
  view = mount(<VoiceAnswer text={text} empty={false} voice={input} onText={() => undefined} />);
  return view.container;
}

describe('i03 «Голосом»: ответ через общий голосовой ввод (B640 i03, .app)', () => {
  it('запись начинается сама и продолжает уже написанное', () => {
    const input = voice();
    render(input);
    expect(input.start).toHaveBeenCalledTimes(1);
    expect(input.start).toHaveBeenCalledWith('Шлюз API');
  });

  it('во время записи — расшифровка с кареткой, как в макете', () => {
    const root = render(voice({ recording: true }));
    const live = root.querySelector('.sd-live[aria-live="polite"]');
    expect(live?.getAttribute('aria-label')).toBe('Ваш ответ, расшифровка по мере речи');
    expect(live?.querySelector('.sd-caret')).not.toBeNull();
  });

  it('в .app после «Стоп» — «Расшифровываем…» без пояснений', () => {
    const root = render(voice({ settling: true }));
    const live = root.querySelector('.sd-live');
    expect(live?.textContent).toContain('Расшифровываем…');
    expect(live?.querySelector('.sd-caret')).toBeNull();
  });

  it('нет микрофона — поле ответа текстом, запись не начинается', () => {
    const input = voice({ supported: false });
    const root = render(input);
    expect(root.querySelector('textarea[aria-label="Ваш ответ"]')).not.toBeNull();
    expect(input.start).not.toHaveBeenCalled();
  });

  it('доступа к микрофону нет — поле ответа текстом', () => {
    const root = render(voice({ failure: 'mic', denied: true }));
    expect(root.querySelector('textarea[aria-label="Ваш ответ"]')).not.toBeNull();
  });

  it('запись не распознана — поле с тем, что есть, и строка об ошибке', () => {
    const root = render(voice({ failure: 'speech' }));
    const field = root.querySelector('textarea[aria-label="Ваш ответ"]') as HTMLTextAreaElement;
    expect(field.value).toBe('Шлюз API');
    expect(root.textContent).toContain('Не удалось распознать запись');
  });
});

describe('answerModeOf: «Голосом / Текстом» появляется, когда голос стал доступен', () => {
  it('без выбора кандидата — голос, если он есть', () => {
    expect(answerModeOf(null, true)).toBe('voice');
    expect(answerModeOf(null, false)).toBe('text');
  });

  it('выбор кандидата сохраняется; без голоса — всегда текст', () => {
    expect(answerModeOf('text', true)).toBe('text');
    expect(answerModeOf('voice', false)).toBe('text');
  });
});

function Probe(props: {
  readonly voice: VoiceInput | null;
  readonly finish: () => void;
  readonly expose: (state: ReturnType<typeof useFinishAfterVoice>) => void;
}) {
  props.expose(useFinishAfterVoice(props.voice, props.finish));
  return null;
}

describe('useFinishAfterVoice: «Закончить и разобрать» во время записи', () => {
  let root: Root | null = null;
  afterEach(() => act(() => root?.unmount()));

  function harness(finish: () => void) {
    const box = document.createElement('div');
    root = createRoot(box);
    let state: ReturnType<typeof useFinishAfterVoice> | null = null;
    const show = (input: VoiceInput | null) =>
      act(() =>
        root?.render(
          <Probe
            voice={input}
            finish={finish}
            expose={(next) => {
              state = next;
            }}
          />,
        ),
      );
    return { show, state: () => state as unknown as ReturnType<typeof useFinishAfterVoice> };
  }

  it('без записи — разбор сразу', () => {
    const finish = vi.fn();
    const probe = harness(finish);
    probe.show(voice());
    act(() => probe.state().request());
    expect(finish).toHaveBeenCalledTimes(1);
    expect(probe.state().waiting).toBe(false);
  });

  it('идёт запись — сначала «Стоп», разбор после расшифровки', () => {
    const finish = vi.fn();
    const probe = harness(finish);
    const recording = voice({ recording: true });
    probe.show(recording);
    act(() => probe.state().request());
    expect(recording.stop).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(probe.state().waiting).toBe(true);
    probe.show(voice({ settling: true }));
    expect(finish).not.toHaveBeenCalled();
    probe.show(voice());
    expect(finish).toHaveBeenCalledTimes(1);
    expect(probe.state().waiting).toBe(false);
  });

  it('текстовый режим — разбор сразу', () => {
    const finish = vi.fn();
    const probe = harness(finish);
    probe.show(null);
    act(() => probe.state().request());
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
