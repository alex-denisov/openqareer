// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bridge from '../../../services/desktop/desktopBridge';
import * as letterApi from '../../vacancies/vacancyLetterApi';
import * as atsDesktop from './ats/atsDesktop';
import { useShownResume, type ShownResume } from './useShownResume';

type Approved = Parameters<typeof useShownResume>[1];

const roots: Array<ReturnType<typeof createRoot>> = [];

async function mount(first: Approved) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const result: { current: ShownResume } = { current: null as never };
  const gates: string[] = [];
  function Harness({ value }: { readonly value: Approved }) {
    result.current = useShownResume('c', value);
    gates.push(result.current.gate);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  const render = (value: Approved) => act(async () => root.render(<Harness value={value} />));
  await render(first);
  return { result, gates, render };
}

const resume = (versionId: string) => ({
  kind: 'targeted' as const,
  versionId,
  documentId: `doc-${versionId}`,
  snapshotAt: '2026-11-25T00:00:00.000Z',
});
const approved = (versionId: string) =>
  ({ documentId: 'letter', applicationId: 'a', resume: resume(versionId) }) as Approved;
const prepare = (versionId: string, replaceable = true) =>
  vi
    .spyOn(letterApi, 'prepareVacancyLetterResume')
    .mockResolvedValue({ ready: true, versionId, replaceable });

describe('показанная версия резюме (B785)', () => {
  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()));
    vi.restoreAllMocks();
  });

  it('новая версия закрывает отправку, пока её не одобрят; уходит ровно она', async () => {
    prepare('v2');
    const attach = vi.spyOn(letterApi, 'attachLetterResume').mockResolvedValue(resume('v2'));
    const value = approved('v1');
    const { result, gates } = await mount(value);
    expect(gates[0]).toBe('checking');
    expect(gates).not.toContain('open');
    expect(result.current.gate).toBe('changed');
    expect(result.current.shown?.versionId).toBe('v2');
    expect(result.current.attached?.versionId).toBe('v1');
    // К моменту нажатия собралась бы уже третья: прикладывается показанная.
    await act(() => result.current.approve('v2'));
    expect(attach).toHaveBeenCalledWith('c', 'v2');
    expect(result.current.gate).toBe('open');
    expect(result.current.attached?.versionId).toBe('v2');
  });

  it('отказ сервера не открывает отправку', async () => {
    prepare('v2');
    vi.spyOn(letterApi, 'attachLetterResume').mockRejectedValue(new Error('409'));
    const value = approved('v1');
    const { result } = await mount(value);
    expect(result.current.gate).toBe('changed');
    await expect(result.current.approve('v2')).rejects.toThrow('409');
    expect(result.current.gate).toBe('changed');
  });

  it('письмо одобрено с другой версией, чем видел кандидат: её одобряют отдельно', async () => {
    prepare('v3');
    const { result, render } = await mount(null);
    await act(() => result.current.approve('v2'));
    const value = approved('v3');
    await render(value);
    expect(result.current.gate).toBe('changed');
    await act(() => result.current.approve('v3'));
    expect(result.current.gate).toBe('open');
  });

  it.each([
    ['та же версия', () => prepare('v1')],
    ['менять нельзя', () => prepare('v2', false)],
    [
      'сборка не удалась',
      () => vi.spyOn(letterApi, 'prepareVacancyLetterResume').mockRejectedValue(new Error('503')),
    ],
  ])('%s: остаётся одобренная', async (_, mock) => {
    mock();
    const value = approved('v1');
    const { result } = await mount(value);
    expect(result.current.gate).toBe('open');
    expect(result.current.shown?.versionId).toBe('v1');
  });

  it('нажатие без подтверждения: версия не пересобирается', async () => {
    vi.spyOn(bridge, 'isTauriEnvironment').mockReturnValue(true);
    vi.spyOn(atsDesktop, 'readAtsAttempt').mockResolvedValue({ result: 'unconfirmed' } as never);
    const asked = prepare('v2');
    const value = approved('v1');
    const { result } = await mount(value);
    expect(result.current.gate).toBe('open');
    expect(asked).not.toHaveBeenCalled();
    expect(result.current.shown?.versionId).toBe('v1');
  });
});
