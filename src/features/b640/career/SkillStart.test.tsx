// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { SkillStart } from './SkillStart';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function show(failed: boolean, onRetry = vi.fn()) {
  view = mount(
    <SkillStart
      current={{ state: 'counting' }}
      busy={false}
      failed={failed}
      otherRoles={[]}
      onStart={vi.fn()}
      onRetry={onRetry}
    />,
  );
  return view.container;
}

describe('SkillStart: вакансии роли ещё считаются (B770)', () => {
  it('на месте строка «Считаем вакансии роли…», без кнопок: экран спрашивает сам', () => {
    const container = show(false);
    expect(container.textContent).toContain('Считаем вакансии роли…');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('не досчитали за все попытки — обычная ошибка с повтором', () => {
    const onRetry = vi.fn();
    const container = show(true, onRetry);
    expect(container.textContent).toContain('Не удалось загрузить проверку навыков.');
    container.querySelector('button')?.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
