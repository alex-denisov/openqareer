// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { B640ApplicationQuota } from '../../../../../shared/b640Vacancies';
import { mount } from '../../kit/testDom';
import { getApplicationQuota } from '../b640Api';
import { QuotaLine } from './QuotaLine';
import { quotaLine } from './quotaModel';

vi.mock('../b640Api', () => ({ getApplicationQuota: vi.fn() }));
vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: vi.fn() }),
}));
const read = vi.mocked(getApplicationQuota);
const quota = (patch: Partial<B640ApplicationQuota>): B640ApplicationQuota => ({
  plan: 'free', limit: 10, used: 7, remaining: 3, renewsAt: null, ...patch,
});

describe('строка остатка откликов: модель', () => {
  it('склоняет слово «отклик»', () => {
    expect(quotaLine(quota({ remaining: 3 }))?.text).toBe('Осталось 3 отклика');
    expect(quotaLine(quota({ remaining: 1 }))?.text).toBe('Осталось 1 отклик');
    expect(quotaLine(quota({ remaining: 0 }))?.text).toBe('Осталось 0 откликов');
  });

  it('показывает строку только при остатке не больше трёх', () => {
    expect(quotaLine(quota({ remaining: 4 }))).toBeNull();
  });

  it('нет лимита или остатка — строки нет', () => {
    expect(quotaLine(quota({ limit: null, remaining: null }))).toBeNull();
    expect(quotaLine(null)).toBeNull();
  });

  it('следующий тариф по сетке Free → Basic → Pro → Max', () => {
    expect(quotaLine(quota({ plan: 'free' }))?.link).toBe('Перейти на Basic');
    expect(quotaLine(quota({ plan: 'basic' }))?.link).toBe('Перейти на Pro');
    expect(quotaLine(quota({ plan: 'pro' }))?.link).toBe('Перейти на Max');
  });

  it('последний или неизвестный тариф — «Тарифы»', () => {
    expect(quotaLine(quota({ plan: 'max' }))?.link).toBe('Тарифы');
    expect(quotaLine(quota({ plan: null }))?.link).toBe('Тарифы');
  });
});

const flush = () => act(async () => {});

describe('строка остатка откликов в карточке', () => {
  beforeEach(() => read.mockReset());

  it('рисует строку из макета со ссылкой на тарифы', async () => {
    read.mockResolvedValue(quota({}));
    const view = mount(<QuotaLine />);
    await flush();
    const line = view.container.querySelector('p.pm-line')!;
    expect(line.querySelector('b.num')?.textContent).toBe('Осталось 3 отклика');
    expect(line.querySelector('a')?.textContent).toBe('Перейти на Basic');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/app/tariffs');
    view.unmount();
  });

  it('запрос упал — строки нет', async () => {
    read.mockRejectedValueOnce(new Error('404'));
    const view = mount(<QuotaLine />);
    await flush();
    expect(view.container.querySelector('p')).toBeNull();
    view.unmount();
  });
});
