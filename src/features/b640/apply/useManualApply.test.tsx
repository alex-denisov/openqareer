// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from '../../applications/applicationsApi';
import { mount, type Mounted } from '../kit/testDom';
import { pressApply } from './applyIntent';
import { useManualApply } from './useManualApply';

const api = vi.hoisted(() => ({ getManualApply: vi.fn(), queueManualApply: vi.fn() }));
vi.mock('./data/manualApplyApi', () => api);

let view: Mounted | null = null;
beforeEach(() => {
  api.getManualApply.mockResolvedValue(null);
  api.queueManualApply.mockResolvedValue(null);
});
afterEach(() => {
  view?.unmount();
  vi.resetAllMocks();
});

function Probe({ stage }: { readonly stage: 'saved' | 'archived' }) {
  const application = { id: 'a', stage } as unknown as ApplicationView;
  useManualApply({ vacancyId: 'v', application }, 'LinkedIn');
  return null;
}

describe('отклик LinkedIn после «Не откликаюсь» (Д16)', () => {
  it('открытие адреса в очередь не ставит', () => {
    view = mount(<Probe stage="archived" />);
    expect(api.queueManualApply).not.toHaveBeenCalled();
    expect(api.getManualApply).toHaveBeenCalledWith('v');
  });

  it('нажатие «Откликнуться» возвращает в очередь, следующее открытие — нет', () => {
    pressApply('v');
    view = mount(<Probe stage="archived" />);
    expect(api.queueManualApply).toHaveBeenCalledTimes(1);
    view.unmount();
    view = mount(<Probe stage="archived" />);
    expect(api.queueManualApply).toHaveBeenCalledTimes(1);
  });

  it('черновик встаёт в очередь при открытии', () => {
    view = mount(<Probe stage="saved" />);
    expect(api.queueManualApply).toHaveBeenCalledTimes(1);
  });
});
