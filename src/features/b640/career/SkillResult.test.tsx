// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { SkillResult, type SkillResultProps } from './SkillResult';
import { hasNoSuggestions } from './useSkillCheck';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function render(decision: 'pending' | 'accepted' | 'declined' | undefined) {
  const onNext = vi.fn();
  const record = {
    assessmentCase: { skillName: 'Kubernetes' },
    evaluation: { grade: 'confirmed', criteria: [] },
    decision,
  } as unknown as SkillResultProps['record'];
  view = mount(
    <SkillResult
      record={record}
      busy={false}
      failed={false}
      onNext={onNext}
      onAgain={() => undefined}
      onAppeal={async () => true}
    />,
  );
  const button = (name: string) =>
    [...view!.container.querySelectorAll('button')].find((item) => item.textContent === name) ??
    null;
  return { onNext, button };
}

describe('SkillResult: итог кейса ждёт решения (B734)', () => {
  it('по макету C4b: «Верно», «Исправить», без «Пропустить»', () => {
    const { onNext, button } = render('pending');
    expect(button('Пропустить')).toBeNull();
    expect(button('Исправить')).not.toBeNull();
    click(button('Верно'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('принятый итог второй раз не спрашивает', () => {
    const { button } = render('accepted');
    expect(button('Верно')).toBeNull();
    expect(button('Пропустить')).toBeNull();
    expect(button('Дальше')).not.toBeNull();
  });

  it('пустой шаг «Что добавить в профиль» распознаётся', () => {
    const run = (status: string, suggestions: unknown[]) =>
      ({ status, suggestions }) as unknown as Parameters<typeof hasNoSuggestions>[0];
    expect(hasNoSuggestions(run('suggestions', []))).toBe(true);
    expect(hasNoSuggestions(run('suggestions', [{}]))).toBe(false);
    expect(hasNoSuggestions(run('cases', []))).toBe(false);
  });
});
