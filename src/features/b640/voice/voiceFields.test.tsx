// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillAnswerField } from '../career/SkillAnswerField';
import { QuickEntry } from '../diary/QuickEntry';
import { ToastHost } from '../kit';
import { mount, type Mounted } from '../kit/testDom';

// B762: поля с диктовкой берут общий голосовой ввод — в .app браузерного распознавания нет,
// и кнопка микрофона появляется только через запись B642.
const voice = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  denied: false,
}));
vi.mock('./useVoiceInput', () => ({
  useVoiceInput: () => ({
    supported: true,
    recording: false,
    settling: false,
    denied: voice.denied,
    failure: voice.denied ? 'mic' : null,
    start: voice.start,
    stop: voice.stop,
  }),
}));
vi.mock('../consultant/useDictation', () => ({
  speechSupported: () => false,
  useDictation: () => ({
    supported: false,
    recording: false,
    settling: false,
    denied: false,
    failure: null,
    start: () => undefined,
    stop: () => undefined,
  }),
}));
vi.mock('../diary/diaryApi', () => ({ createEntry: vi.fn() }));

let view: Mounted | null = null;

async function render(node: React.ReactElement) {
  await act(async () => {
    view = mount(node);
  });
  return view!.container;
}

function micButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('button[aria-label="Надиктовать"]');
}

beforeEach(() => {
  vi.clearAllMocks();
  voice.denied = false;
});

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('B762: голосовой ввод в полях без браузерного распознавания', () => {
  it('ответ о навыке: кнопка микрофона есть, запись начинается с текстом поля', async () => {
    const root = await render(
      <>
        <SkillAnswerField value="Начало" onChange={() => undefined} />
        <ToastHost />
      </>,
    );
    const button = micButton(root);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(voice.start).toHaveBeenCalledWith('Начало');
  });

  it('быстрая запись дневника: кнопка микрофона есть, отказ показывает строку', async () => {
    voice.denied = true;
    const root = await render(<QuickEntry kind="note" onCreated={() => undefined} />);
    expect(micButton(root)).not.toBeNull();
    expect(root.textContent).toContain('Нет доступа к микрофону');
  });
});
