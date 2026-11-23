// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { SkillStart } from './SkillStart';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

describe('SkillStart: вакансии роли ещё считаются (B770)', () => {
  it('строка «Считаем вакансии роли» и «Обновить» перечитывает проверку', () => {
    const onRetry = vi.fn();
    const onStart = vi.fn();
    view = mount(
      <SkillStart
        current={{ state: 'counting' }}
        busy={false}
        failed={false}
        otherRoles={[]}
        onStart={onStart}
        onRetry={onRetry}
      />,
    );
    expect(view.container.textContent).toContain('Считаем вакансии роли');
    const button = [...view.container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Обновить',
    );
    button?.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});
