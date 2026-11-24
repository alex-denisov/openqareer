// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { useVoiceInput, type VoiceInput } from '../voice/useVoiceInput';

type State = 'denied' | 'recording';
const machine = vi.hoisted(() => ({
  approve: vi.fn(),
  onState: (_: string): void => undefined,
}));
vi.mock('../../coach/voiceInputController', () => ({
  VoiceInputController: class {
    constructor(callbacks: { onState: (state: string) => void }) {
      machine.onState = callbacks.onState;
    }
    activate() {}
    dispose() {}
    sent() {}
    request() {}
    finish() {}
    approve(text: string) {
      machine.approve(text);
    }
  },
}));

let view: Mounted | null = null;
let voice: VoiceInput | null = null;

function Child({ start }: { readonly start: (text: string) => void }) {
  useEffect(() => start('Шлюз'), [start]);
  return null;
}
function Parent() {
  voice = useVoiceInput(() => undefined);
  return <Child start={voice.start} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('SpeechRecognition', { available: () => undefined });
});
afterEach(() => {
  view?.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('B681: запуск из дочернего эффекта не теряется до готовности контроллера', () => {
  view = mount(<Parent />);
  expect(machine.approve).toHaveBeenCalledTimes(1);
  expect(machine.approve).toHaveBeenCalledWith('Шлюз');
});

it('B750: отказ в микрофоне остаётся и после того, как строка о нём погасла', () => {
  view = mount(<Parent />);
  const denied: State = 'denied';
  act(() => machine.onState(denied));
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(voice?.denied).toBe(false);
  expect(voice?.failure).toBe('mic');
});
