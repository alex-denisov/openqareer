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
}: {
  hideMany?: (entries: readonly { item: unknown; reason: string }[]) => Promise<readonly string[]>;
  items?: typeof ITEMS;
}) {
  const [shown, setShown] = useState(items);
  const triage = useTriage(shown, hideMany as never);
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
      />
      <button id="start" onClick={triage.start} />
      <button id="cancel" onClick={triage.cancel} />
      <button id="yes" onClick={() => triage.answer(true)} />
      <button id="retry" onClick={triage.retry} />
      <button id="toggle-a" onClick={() => triage.toggle('a')} />
      <button id="hide" onClick={triage.hideSelected} />
      <button id="narrow" onClick={() => setShown(items.slice(0, 2))} />
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
    expect(request.mock.calls[0]![0]).toEqual(['a', 'b', 'c']);
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

  it('гонка: ответ старого разбора не перезаписывает новый', async () => {
    const resolvers: Array<(value: VacancyTriage) => void> = [];
    request.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const view = mount(<Probe />);
    press(view.container, 'start');
    press(view.container, 'narrow');
    expect(resolvers).toHaveLength(2);
    await act(async () => resolvers[1]!(result([hide('a'), keep('b')])));
    await act(async () => resolvers[0]!(result([hide('a'), hide('b'), hide('c')])));
    expect(out(view.container).dataset).toMatchObject({ status: 'ready', picked: '1', total: '2' });
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

  it('смена списка в режиме запускает разбор заново', async () => {
    request.mockResolvedValue(result([hide('a'), keep('b'), keep('c')]));
    const view = mount(<Probe />);
    press(view.container, 'start');
    await flush();
    press(view.container, 'narrow');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0]).toEqual(['a', 'b']);
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
