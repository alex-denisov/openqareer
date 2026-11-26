// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';

interface ModalProps {
  readonly isOpen: boolean;
  readonly connectOnly?: boolean;
  readonly onClose: () => void;
  readonly onConnectSuccess: (
    resumes: readonly unknown[],
    parsed: unknown,
    url: string,
  ) => Promise<void>;
}
const modal = vi.hoisted(() => ({ last: null as ModalProps | null }));
const session = vi.hoisted(() => ({ connectHhFromSession: vi.fn() }));
vi.mock('../../connections/HhConnectModal', () => ({
  HhConnectModal: (props: ModalProps) => {
    modal.last = props;
    return props.isOpen ? <div role="dialog" /> : null;
  },
}));
vi.mock('./hhResumeSession', () => session);

const { HhConnectAction, hhImportMode } = await import('./HhConnectAction');

let view: Mounted | null = null;
const show = (search: string, onConnected = vi.fn()) => {
  window.history.replaceState(null, '', `/app/account/connections${search}`);
  view = mount(<HhConnectAction onConnected={onConnected} onEmpty={vi.fn()} />);
  return onConnected;
};
const dialog = () => view?.container.querySelector('[role="dialog"]') ?? null;

beforeEach(() => {
  vi.resetAllMocks();
  modal.last = null;
});
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('n03: подключение hh.ru из строки', () => {
  it('признак импорта из a11b: 1 — профиль, 0 — только подключение, без признака — нет', () => {
    expect(hhImportMode('?import=1')).toBe('profile');
    expect(hhImportMode('?import=0')).toBe('connect_only');
    expect(hhImportMode('')).toBeNull();
  });

  it('без признака окно открывает кнопка «Подключить»', () => {
    show('');
    expect(dialog()).toBeNull();
    click(view?.container.querySelector('button[aria-label="Подключить hh.ru"]') ?? null);
    expect(dialog()).not.toBeNull();
  });

  it('из a11b без импорта: окно открыто сразу, подключение без импорта', async () => {
    const onConnected = show('?import=0');
    expect(dialog()).not.toBeNull();
    expect(modal.last?.connectOnly).toBe(true);
    session.connectHhFromSession.mockResolvedValue(undefined);
    await act(() => modal.last!.onConnectSuccess([], { rawText: 'x' }, 'https://hh.ru/resume/1'));
    expect(session.connectHhFromSession).toHaveBeenCalledWith(
      { rawText: 'x' },
      'https://hh.ru/resume/1',
      'connect_only',
    );
    expect(onConnected).toHaveBeenCalled();
  });

  it('из a11b с импортом: профиль из резюме; сбой уходит в окно', async () => {
    const onConnected = show('?import=1');
    expect(modal.last?.connectOnly).toBe(false);
    session.connectHhFromSession.mockRejectedValue(new Error('boom'));
    await expect(modal.last!.onConnectSuccess([], { rawText: 'x' }, 'u')).rejects.toThrow('boom');
    expect(session.connectHhFromSession).toHaveBeenCalledWith({ rawText: 'x' }, 'u', 'profile');
    expect(onConnected).not.toHaveBeenCalled();
  });
});
