import { describe, expect, it, vi } from 'vitest';

const preload = vi.hoisted(() => vi.fn());
vi.mock('./account/index', () => ({ default: () => null, preload }));

import { preloadSection } from './sections';

describe('preloadSection (B773)', () => {
  it('грузит раздел адреса и просит его данные узла', async () => {
    await preloadSection('/app/account/connections');
    expect(preload).toHaveBeenCalledWith('n03', '');
  });

  it('B792: корень попросили дважды — чтение одно; другой адрес читается', async () => {
    preload.mockClear();
    await preloadSection('/app/account/data');
    await preloadSection('/app/account/data');
    expect(preload).toHaveBeenCalledTimes(1);
    await preloadSection('/app/account/connections');
    expect(preload).toHaveBeenCalledTimes(2);
  });

  it('чужой адрес ничего не грузит', async () => {
    preload.mockClear();
    await preloadSection('/vacancies');
    expect(preload).not.toHaveBeenCalled();
  });
});
