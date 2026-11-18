// @vitest-environment jsdom
import { act, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VacancyTriage, VacancyTriageRow } from '../../../../../shared/b640Vacancies';
import { click, mount } from '../../kit/testDom';
import { requestTriage } from '../triageApi';
import { makeItem } from './fixtures';
import { useTriage } from './useTriage';

vi.mock('../triageApi', () => ({ requestTriage: vi.fn() }));
const request = vi.mocked(requestTriage);

const hide = (id: string): VacancyTriageRow => ({
  clusterId: id,
  verdict: 'hide',
  reasonId: 'role-family',
  reasonLabel: 'не та роль',
});
const keep = (id: string): VacancyTriageRow => ({ clusterId: id, verdict: 'keep' });
const needs = (id: string): VacancyTriageRow => ({
  clusterId: id,
  verdict: 'needs_data',
  questionId: 'salaryLowerBound',
});

function result(rows: VacancyTriageRow[], withQuestion = false): VacancyTriage {
  const count = (verdict: string) => rows.filter((row) => row.verdict === verdict).length;
  return {
    rows,
    questions: withQuestion ? [{ id: 'salaryLowerBound', text: 'Сравнивать по нижней границе зарплаты?' }] : [],
    questionTotal: withQuestion ? 1 : 0,
    summary: { total: rows.length, keep: count('keep'), hide: count('hide'), needsData: count('needs_data') },
  };
}

const ITEMS = ['a', 'b', 'c'].map((id) => makeItem({ id }));
const flush = () => act(async () => {});

function Probe({
  hideMany = async () => [],
  items = ITEMS,
  query = null,
}: {
  query?: string | null;
  hideMany?: (entries: readonly { item: unknown; reason: string }[]) => Promise<readonly string[]>;
  items?: typeof ITEMS;
}) {
  const [shown, setShown] = useState(items);
  const triage = useTriage(shown, hideMany as never, { query, expected: 883 });
  return (
    <div>
      <output
        data-active={String(triage.active)}
        data-status={triage.status}
        data-picked={triage.picked}
        data-total={triage.total}
        data-weak={String(triage.weak)}
        data-question={triage.question?.text ?? ''}
        data-hide={triage.hide.status}
        data-failed={triage.hide.failed}
        data-pick-a={String(triage.isPicked('a'))}
        data-why-a={triage.rowFor('a')?.reasonLabel ?? ''}
        data-nothing={triage.nothing === null ? '' : String(triage.nothing.total)}
        data-nothing-pool={triage.nothing?.pool === undefined ? '' : String(triage.nothing.pool)}
      />
      <button id="start" onClick={triage.start} />
      <button id="cancel" onClick={triage.cancel} />
      <button id="yes" onClick={() => triage.answer(true)} />
      <button id="retry" onClick={triage.retry} />
      <button id="toggle-a" onClick={() => triage.toggle('a')} />
      <button id="hide" onClick={triage.hideSelected} />
      <button id="narrow" onClick={() => setShown(items.slice(0, 2))} />
      <button id="grow" onClick={() => setShown((current) => [...current, makeItem({ id: `n${current.length}` })])} />
      <button id="reorder" onClick={() => setShown((current) => [...current].reverse())} />
      <button id="clear" onClick={triage.clearResult} />
    </div>
  );
}

const out = (root: HTMLElement) => root.querySelector('output')!;
const press = (root: HTMLElement, id: string) => click(root.querySelector(`#${id}`));

beforeEach(() => {
  request.mockReset();
});

describe('режим «Помочь выбрать»', () => {
  it('первый разбор: весь список уходит на сервер, hide отмечены', async () => {
    request.mockResolvedValue(result([hide('a'), keep('b'), keep('c')]));
    const view = mount(<Probe />);
    expect(out(view.container).dataset.active).toBe('false');
    expect(request).not.toHaveBeenCalled();
    press(view.container, 'start');
    expect(out(view.container).dataset.status).toBe('loading');
    expect(out(view.container).dataset.total).toBe('3');
    await flush();
    expect(request.mock.calls[0]![0]).toEqual({ clusterIds: ['a', 'b', 'c'] });
    expect(request.mock.calls[0]![1]).toEqual({});
    expect(out(view.container).dataset).toMatchObject({ status: 'ready', picked: '1', pickA: 'true', whyA: 'не та роль' });
    view.unmount();
  });

  it('ответ на вопрос отправляет разбор заново с ответами, счётчик растёт', async () => {
    request.mockResolvedValueOnce(result([hide('a'), needs('b'), keep('c')], true));
    request.mockResolvedValueOnce(result([hide('a'), hide('b'), keep('c')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    expect(out(view.container).dataset.question).toBe('Сравнивать по нижней границе зарплаты?');
    expect(out(view.container).dataset.picked).toBe('1');
    press(view.container, 'yes');
    await flush();
    expect(request.mock.calls[1]![1]).toEqual({ salaryLowerBound: true });
    expect(out(view.container).dataset).toMatchObject({ picked: '2', question: '' });
    view.unmount();
  });

  it('флажок снимается и ставится обратно', async () => {
    request.mockResolvedValue(result([hide('a'), hide('b'), keep('c')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    press(view.container, 'toggle-a');
    expect(out(view.container).dataset).toMatchObject({ picked: '1', pickA: 'false' });
    press(view.container, 'toggle-a');
    expect(out(view.container).dataset.picked).toBe('2');
    view.unmount();
  });

  it('одно нажатие — один запрос: дочитывание и перестановка списка разбор не перезапускают', async () => {
    const resolvers: Array<(value: VacancyTriage) => void> = [];
    request.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const view = mount(<Probe />);
    press(view.container, 'start');
    press(view.container, 'grow');
    press(view.container, 'grow');
    press(view.container, 'reorder');
    press(view.container, 'narrow');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toEqual({ clusterIds: ['a', 'b', 'c'] });
    expect(out(view.container).dataset.total).toBe('3');
    await act(async () => resolvers[0]!(result([hide('a'), keep('b'), keep('c')])));
    press(view.container, 'grow');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(out(view.container).dataset).toMatchObject({ status: 'ready', picked: '1', total: '3' });
    view.unmount();
  });

  it('вся подборка: один запрос с фильтрами без списка id, дочитывание его не перезапускает', async () => {
    request.mockResolvedValue({ ...result([hide('a'), keep('b'), hide('zz')]), poolTotal: 3 });
    const view = mount(<Probe query="role=%D0%A0" />);
    press(view.container, 'start');
    expect(out(view.container).dataset).toMatchObject({ active: 'true', status: 'loading', total: '883' });
    press(view.container, 'grow');
    press(view.container, 'reorder');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toEqual({ query: 'role=%D0%A0' });
    expect(out(view.container).dataset).toMatchObject({ status: 'ready', picked: '2', total: '3' });
    view.unmount();
  });

  it('вся подборка: скрываются и вакансии, которых клиент ещё не дочитал', async () => {
    request.mockResolvedValue({ ...result([hide('a'), keep('b'), hide('zz')]), poolTotal: 3 });
    const hideMany = vi.fn(async (_entries: readonly unknown[]): Promise<readonly string[]> => []);
    const view = mount(<Probe query="" hideMany={hideMany} />);
    press(view.container, 'start');
    await flush();
    press(view.container, 'hide');
    await flush();
    const entries = hideMany.mock.calls[0]![0] as ReadonlyArray<{ id: string; reason: string; item?: unknown }>;
    expect(entries.map((entry) => [entry.id, entry.reason, Boolean(entry.item)])).toEqual([
      ['a', 'role-family', true],
      ['zz', 'role-family', false],
    ]);
    expect(out(view.container).dataset.active).toBe('false');
    view.unmount();
  });

  it('вся подборка больше потолка: итог несёт и разобранное, и размер подборки', async () => {
    request.mockResolvedValue({ ...result([keep('a'), keep('b'), keep('c')]), poolTotal: 1005 });
    const view = mount(<Probe query="" />);
    press(view.container, 'start');
    await flush();
    expect(out(view.container).dataset).toMatchObject({ active: 'false', nothing: '3', nothingPool: '1005' });
    view.unmount();
  });

  it('повторное нажатие разбирает список, видимый в этот момент', async () => {
    request.mockResolvedValue(result([hide('a'), keep('b')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    press(view.container, 'cancel');
    press(view.container, 'narrow');
    press(view.container, 'start');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0]).toEqual({ clusterIds: ['a', 'b'] });
    view.unmount();
  });

  it('скрывать нечего: режим закрывается сам, остаётся итог с числом вакансий', async () => {
    request.mockResolvedValue(result([keep('a'), keep('b'), keep('c')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    expect(out(view.container).dataset).toMatchObject({ active: 'false', nothing: '3' });
    expect(request).toHaveBeenCalledTimes(1);
    press(view.container, 'clear');
    expect(out(view.container).dataset.nothing).toBe('');
    view.unmount();
  });

  it('скрывать нечего, но есть вопрос: режим остаётся; после ответа без скрытия — итог', async () => {
    request.mockResolvedValueOnce(result([keep('a'), needs('b'), keep('c')], true));
    request.mockResolvedValueOnce(result([keep('a'), keep('b'), keep('c')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    expect(out(view.container).dataset).toMatchObject({ active: 'true', nothing: '' });
    press(view.container, 'yes');
    await flush();
    expect(out(view.container).dataset).toMatchObject({ active: 'false', nothing: '3' });
    expect(request).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('сбой: режим открыт, «Повторить» разбирает снова', async () => {
    request.mockRejectedValueOnce(new Error('сеть'));
    request.mockResolvedValueOnce(result([hide('a'), keep('b'), keep('c')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    expect(out(view.container).dataset).toMatchObject({ status: 'failed', active: 'true' });
    press(view.container, 'retry');
    await flush();
    expect(out(view.container).dataset).toMatchObject({ status: 'ready', picked: '1' });
    view.unmount();
  });

  it('«Слабо совпадает», когда подходящих меньше половины', async () => {
    request.mockResolvedValue(result([hide('a'), hide('b'), keep('c')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    expect(out(view.container).dataset.weak).toBe('true');
    view.unmount();
  });

  it('«Отмена» закрывает режим без скрытия', async () => {
    request.mockResolvedValue(result([hide('a'), keep('b'), keep('c')]));
    const hideMany = vi.fn(async (_entries: readonly unknown[]): Promise<string[]> => []);
    const view = mount(<Probe hideMany={hideMany} />);
    press(view.container, 'start');
    await flush();
    press(view.container, 'cancel');
    expect(out(view.container).dataset).toMatchObject({ active: 'false', status: 'idle', picked: '0' });
    expect(hideMany).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('«Скрыть выбранные»', () => {
  it('скрывает отмеченные с их причинами и закрывает режим', async () => {
    request.mockResolvedValue(result([hide('a'), hide('b'), keep('c')]));
    const hideMany = vi.fn(async (_entries: readonly unknown[]): Promise<string[]> => []);
    const view = mount(<Probe hideMany={hideMany} />);
    press(view.container, 'start');
    await flush();
    press(view.container, 'toggle-a');
    press(view.container, 'hide');
    await flush();
    const entries = hideMany.mock.calls[0]![0] as { item: { cluster: { id: string } }; reason: string }[];
    expect(entries.map((entry) => [entry.item.cluster.id, entry.reason])).toEqual([['b', 'role-family']]);
    expect(out(view.container).dataset.active).toBe('false');
    view.unmount();
  });

  it('частичный сбой: режим остаётся, ошибка с числом нескрытых', async () => {
    request.mockResolvedValue(result([hide('a'), hide('b'), keep('c')]));
    const hideMany = vi.fn(async (_entries: readonly unknown[]): Promise<string[]> => ['b']);
    const view = mount(<Probe hideMany={hideMany} />);
    press(view.container, 'start');
    await flush();
    press(view.container, 'hide');
    await flush();
    expect(out(view.container).dataset).toMatchObject({ active: 'true', hide: 'failed', failed: '1' });
    view.unmount();
  });
});
