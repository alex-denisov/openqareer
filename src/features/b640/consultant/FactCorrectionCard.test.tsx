// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { FactCorrectionCard } from './FactCorrectionCard';

const api = vi.hoisted(() => ({ correctFact: vi.fn(), revertFactCorrection: vi.fn() }));
vi.mock('../profile/factCorrectionApi', () => api);

const PROPOSAL = {
  target: { kind: 'about' as const },
  before: 'маржа 80 %',
  after: 'маржа 40 %',
  place: 'О себе',
};
let view: Mounted | null = null;

afterEach(() => {
  view?.unmount();
  view = null;
  vi.clearAllMocks();
});

async function press(name: string): Promise<void> {
  const found = [...view!.container.querySelectorAll('button')].find(
    (item) => item.textContent === name,
  );
  click(found!);
  await act(async () => {
    for (let step = 0; step < 6; step += 1) await Promise.resolve();
  });
}
const words = () => view!.container.textContent ?? '';

it('«Применено» только после ответа о записи, отмена возвращает все копии', async () => {
  api.correctFact.mockResolvedValue({ changes: [PROPOSAL] });
  api.revertFactCorrection.mockResolvedValue(undefined);
  view = mount(<FactCorrectionCard proposal={PROPOSAL} />);
  await press('Применить');
  expect(words()).toContain('Применено');
  await press('Отменить');
  expect(words()).toContain('Применить');
  expect(api.revertFactCorrection).toHaveBeenCalledWith([PROPOSAL]);
});

it('сбой записи виден, успеха нет', async () => {
  api.correctFact.mockRejectedValue(new Error('x'));
  view = mount(<FactCorrectionCard proposal={PROPOSAL} />);
  await press('Применить');
  expect(words()).toContain('Правка не применилась');
  expect(words()).not.toContain('Применено');
});
