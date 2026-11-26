// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateStatusToday } from '../../../../shared/candidateStatus';
import { mount, type Mounted } from '../kit/testDom';
import { StatusStrip } from './StatusStrip';

vi.mock('../shell/ShellContext', () => ({ useShell: () => ({ navigate: () => undefined }) }));

let view: Mounted | null = null;
afterEach(() => view?.unmount());

const STATUS: CandidateStatusToday = {
  status: 'job_search',
  title: 'Ищу работу',
  chosen: true,
  since: '2026-10-02T08:00:00.000Z',
  modules: [],
  revert: null,
};

function render(funnel?: string | null) {
  view = mount(
    <StatusStrip status={STATUS} revertedTitle={null} onReverted={() => {}} funnel={funnel} />,
  );
  return view.container.querySelector('.s5-prog');
}

describe('StatusStrip (B650 s05b)', () => {
  it('путь откликов стоит между статусом и «Сменить»', () => {
    const strip = render('С 2 октября: 13 откликов → 1 интервью → 1 оффер');
    const parts = [...(strip?.children ?? [])].map((child) => child.textContent);
    expect(parts).toEqual([
      'Статус: Ищу работу',
      'С 2 октября: 13 откликов → 1 интервью → 1 оффер',
      'Сменить',
    ]);
  });

  it('без откликов строки пути нет', () => {
    expect(render(null)?.querySelector('.num')).toBeNull();
  });

  it('макет s04: вопрос над колонками — строки «Статус» нет, «Статус возвращён» остаётся', () => {
    view = mount(
      <StatusStrip status={STATUS} revertedTitle={null} onReverted={() => {}} withoutRow />,
    );
    expect(view.container.querySelector('.s5-prog')).toBeNull();
    view.unmount();
    view = mount(
      <StatusStrip status={STATUS} revertedTitle="Ищу работу" onReverted={() => {}} withoutRow />,
    );
    expect(view.container.querySelector('.s5-prog')).toBeNull();
    expect(view.container.textContent).toContain('Статус возвращён: Ищу работу');
  });
});
