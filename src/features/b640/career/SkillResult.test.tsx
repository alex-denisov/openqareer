// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { SkillResult, type SkillResultProps } from './SkillResult';
import { hasNoSuggestions } from './useSkillCheck';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function render(decision: 'pending' | 'accepted' | 'declined' | undefined) {
  const onNext = vi.fn();
  const onSkip = vi.fn();
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
      onSkip={onSkip}
      onAgain={() => undefined}
      onAppeal={async () => true}
    />,
  );
  const button = (name: string) =>
    [...view!.container.querySelectorAll('button')].find((item) => item.textContent === name) ??
    null;
  return { onNext, onSkip, button };
}

describe('SkillResult: итог кейса ждёт решения (B734)', () => {
  it('«Верно» и «Пропустить» — разные решения', () => {
    const { onNext, onSkip, button } = render('pending');
    click(button('Пропустить'));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onNext).not.toHaveBeenCalled();
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
