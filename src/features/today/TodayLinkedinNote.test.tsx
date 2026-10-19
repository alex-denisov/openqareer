// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayLinkedinNote, todayLinkedinNoteCopy } from './TodayLinkedinNote';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((done) => done()));

function mount(props: Parameters<typeof TodayLinkedinNote>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<TodayLinkedinNote {...props} />));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('TodayLinkedinNote (макет 1 «Частично: LinkedIn не подключён»)', () => {
  it('names hh.ru only when hh.ru is connected', () => {
    expect(todayLinkedinNoteCopy(['hh'])).toBe(
      'Очередь собрана по hh.ru. Постов и контактов LinkedIn пока нет: доступно после подключения.',
    );
    expect(todayLinkedinNoteCopy([])).toBe(
      'Постов и контактов LinkedIn пока нет: доступно после подключения.',
    );
    expect(todayLinkedinNoteCopy(['linkedin', 'hh'])).toBeNull();
  });

  it('offers to connect LinkedIn through the real connection flow', () => {
    const onOpenConnections = vi.fn();
    const container = mount({ queueSize: 3, connectedSources: ['hh'], onOpenConnections });
    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Подключить LinkedIn');
    act(() => button?.click());
    expect(onOpenConnections).toHaveBeenCalledOnce();
  });

  it('stays silent with an empty queue or without the field from the server', () => {
    expect(mount({ queueSize: 0, connectedSources: [] }).textContent).toBe('');
    expect(mount({ queueSize: 3 }).textContent).toBe('');
  });
});
