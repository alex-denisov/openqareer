import { AdaptationAdviceContext } from './AdaptationAdviceContext';
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptationTaskProposal } from './AdaptationTaskProposal';
import type { AdaptationContext } from '../../../shared/adaptationCoach';

const fetchApi = vi.hoisted(() => vi.fn());
vi.mock('../coach/apiClient', async importOriginal => ({ ...await importOriginal<object>(), apiFetch: fetchApi }));
const context: AdaptationContext = { workplaceId: 'work', planId: 'plan', stage: 'days_1_30', version: 'a'.repeat(64), label: 'Тестовая работа · Дни 1–30', readOnly: false };
const props = { turnKey: 'turn', context, suggestion: { title: 'Уточнить ожидания', description: 'Согласовать критерий.', dueDate: '2026-11-01' }, currentSubject: { kind: 'adaptation' as const, id: 'work', planId: 'plan', adaptationStage: 'days_1_30' as const } };
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ''; vi.clearAllMocks(); });
async function mount(input: Parameters<typeof AdaptationTaskProposal>[0] = props) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<AdaptationTaskProposal {...input} />));
  return host;
}

describe('B357 adaptation proposal confirmation', () => {
  it('does not mutate on render, retains error on failed save and confirms only the successful retry', async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ data: { status: 'available' } }));
    const host = await mount();
    expect(fetchApi).toHaveBeenCalledTimes(1);
    fetchApi.mockResolvedValueOnce(Response.json({ error: { message: 'Связь потеряна', code: 'unavailable', retryable: true } }, { status: 503 }));
    const form = host.querySelector('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.textContent).toContain('Связь потеряна');
    expect(host.textContent).not.toContain('Изменение плана сохранено.');
    fetchApi.mockResolvedValueOnce(Response.json({ data: { id: 'work' } }));
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.textContent).toContain('Изменение плана сохранено.');
    expect(fetchApi.mock.calls[1][0]).toBe(fetchApi.mock.calls[2][0]);
    expect(fetchApi.mock.calls[1][1].body).toBe(fetchApi.mock.calls[2][1].body);
  });
  it('blocks stale or unrelated context and restores applied state from the server', async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ data: { status: 'available' } }));
    const host = await mount({ ...props, currentSubject: { ...props.currentSubject, id: 'other-work' } });
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('контекст изменился');
    fetchApi.mockResolvedValueOnce(Response.json({ data: { status: 'applied' } }));
    const restored = await mount();
    expect(restored.textContent).toContain('Изменение плана сохранено.');
    expect(restored.querySelector('form')).toBeNull();
  });
  it('does not claim a changed plan when its state cannot be loaded', async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ error: { message: 'Проверка недоступна', code: 'unavailable', retryable: true } }, { status: 503 }));
    const host = await mount();
    expect(host.textContent).not.toContain('План или контекст изменился');
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('Повторить проверку');
  });
  it('shows the current task and confirms an update without allowing the client to choose its target', async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ data: { status: 'available', target: { title: 'Исходная задача', description: 'Старый критерий', dueDate: '2026-10-20' } } }));
    const host = await mount({ ...props, suggestion: { ...props.suggestion, targetTaskId: 'existing-task' } });
    expect(host.textContent).toContain('Текущая задача: Исходная задача');
    expect(host.textContent).toContain('Сохранить изменение задачи');
    fetchApi.mockResolvedValueOnce(Response.json({ data: { id: 'work' } }));
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.textContent).toContain('Изменение плана сохранено.');
    expect(JSON.parse(fetchApi.mock.calls[1][1].body)).not.toHaveProperty('targetTaskId');
  });
  it('marks a reply whose plan changed while the answer was being generated', async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ data: { stale: true, readOnly: false } }));
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    await act(async () => root.render(<AdaptationAdviceContext turnKey="answer-turn" />));
    expect(host.textContent).toContain('Ответ относится к предыдущему состоянию плана');
    expect(fetchApi.mock.calls[0][0]).toContain('/adaptation-context/answer-turn');
  });
  it('only dismisses after server-confirmed rejection', async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ data: { status: 'available' } }));
    const host = await mount();
    const reject = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Отклонить предложение')!;
    fetchApi.mockResolvedValueOnce(Response.json({ data: { ok: true } }));
    await act(async () => reject.click());
    expect(host.textContent).toBe('');
    expect(JSON.parse(fetchApi.mock.calls[1][1].body).proposalKey).toBe('adaptation:turn');
  });
});
