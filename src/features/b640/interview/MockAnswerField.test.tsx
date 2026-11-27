// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceInput } from '../voice/useVoiceInput';
import { click, mount, type Mounted } from '../kit/testDom';
import { MockAnswerField } from './MockAnswerField';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function dictation(over: Partial<VoiceInput> = {}): VoiceInput {
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

function render(voice: VoiceInput, readOnly = false) {
  view = mount(
    <MockAnswerField
      text="В 2024 году"
      readOnly={readOnly}
      empty={false}
      dictation={voice}
      onChange={() => undefined}
    />,
  );
  return view.container;
}

describe('MockAnswerField: микрофон в поле ответа (I2)', () => {
  it('надиктовать: сказанное дописывается к уже написанному', () => {
    const voice = dictation();
    const root = render(voice);
    const mic = root.querySelector('.fld-mic button.mic-btn') as HTMLButtonElement;
    expect(mic.getAttribute('aria-label')).toBe('Надиктовать');
    click(mic);
    expect(voice.start).toHaveBeenCalledWith('В 2024 году');
  });

  it('во время записи кнопка останавливает её', () => {
    const voice = dictation({ recording: true });
    const root = render(voice);
    const mic = root.querySelector('button.mic-btn.is-rec') as HTMLButtonElement;
    expect(mic.getAttribute('aria-label')).toBe('Остановить запись');
    click(mic);
    expect(voice.stop).toHaveBeenCalled();
  });

  it('нет доступа к микрофону: погасшая кнопка с подсказкой, как в макете', () => {
    const root = render(dictation({ failure: 'mic' }));
    const mic = root.querySelector('button.mic-btn.is-off') as HTMLButtonElement;
    expect(mic.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('#mi-mic-off-tip')?.textContent).toBe('Нет доступа к микрофону');
  });

  it('не распознали: строка с повтором, повтор снова пишет', () => {
    const voice = dictation({ failure: 'speech' });
    const root = render(voice);
    const line = root.querySelector('.mi-rec-err[role="alert"]') as HTMLElement;
    expect(line.textContent).toContain('Не удалось распознать запись');
    click(line.querySelector('button') as HTMLButtonElement);
    expect(voice.start).toHaveBeenCalledWith('В 2024 году');
  });

  it('браузер без распознавания и разобранный ответ: кнопки нет', () => {
    expect(render(dictation({ supported: false })).querySelector('.mic-btn')).toBeNull();
    view?.unmount();
    expect(render(dictation(), true).querySelector('.mic-btn')).toBeNull();
  });
});
