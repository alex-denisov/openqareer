// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { WhenForm } from './WhenForm';

const api = vi.hoisted(() => ({ createApplicationInterview: vi.fn(async () => ({})) }));
vi.mock('../../applications/applicationsApi', () => api);

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function type(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('B749: формат интервью уходит вместе с датой', async () => {
  view = mount(<WhenForm responseId="r1" onCreated={() => undefined} />);
  type('iw-when', '12.11.2099 15:00');
  type('iw-format', ' видеозвонок ');
  await act(async () => (view!.container.querySelector('button') as HTMLButtonElement).click());
  expect(api.createApplicationInterview).toHaveBeenCalledWith('r1', {
    round: 1,
    scheduledAt: new Date(2099, 10, 12, 15, 0).toISOString(),
    format: 'видеозвонок',
  });
});
