// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateConnection } from '../coach/coachApi';
import { TodayLinkedinNote, todayLinkedinNoteCopy } from './TodayLinkedinNote';

const api = vi.hoisted(() => ({ getConnections: vi.fn() }));
vi.mock('../coach/coachApi', () => api);

const base = { available: true, capabilities: [], importsCareerHistory: true };
const off = (platform: 'linkedin' | 'hh'): CandidateConnection => ({
  ...base,
  platform,
  status: 'disconnected',
});
const on = (platform: 'linkedin' | 'hh'): CandidateConnection => ({
  ...base,
  platform,
  status: 'connected',
  accessMode: 'native_session_snapshot',
  connectedAt: '2026-10-01T00:00:00.000Z',
  lastImportedAt: '2026-10-01T00:00:00.000Z',
  factCount: 3,
});

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((done) => done()));

async function mount(onOpenConnections = vi.fn(), queueSize = 3) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TodayLinkedinNote queueSize={queueSize} onOpenConnections={onOpenConnections} />);
  });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('TodayLinkedinNote (макет 1 «Частично: LinkedIn не подключён»)', () => {
  it('names hh.ru only when hh.ru is connected', () => {
    expect(todayLinkedinNoteCopy([off('linkedin'), on('hh')])).toBe(
      'Очередь собрана по hh.ru. Постов и контактов LinkedIn пока нет: доступно после подключения.',
    );
    expect(todayLinkedinNoteCopy([off('linkedin'), off('hh')])).toBe(
      'Постов и контактов LinkedIn пока нет: доступно после подключения.',
    );
    expect(todayLinkedinNoteCopy([on('linkedin'), on('hh')])).toBeNull();
  });

  it('offers to connect LinkedIn through the real connection flow', async () => {
    api.getConnections.mockResolvedValue([off('linkedin'), on('hh')]);
    const onOpenConnections = vi.fn();
    const container = await mount(onOpenConnections);
    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Подключить LinkedIn');
    act(() => button?.click());
    expect(onOpenConnections).toHaveBeenCalledOnce();
  });

  it('stays silent with an empty queue or unreadable connections', async () => {
    api.getConnections.mockResolvedValue([off('linkedin')]);
    expect((await mount(vi.fn(), 0)).textContent).toBe('');
    api.getConnections.mockRejectedValue(new Error('offline'));
    expect((await mount()).textContent).toBe('');
  });
});
