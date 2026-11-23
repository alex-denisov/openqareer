import { describe, expect, it, vi } from 'vitest';

const preload = vi.hoisted(() => vi.fn());
vi.mock('./account/index', () => ({ default: () => null, preload }));

import { preloadSection } from './sections';

describe('preloadSection (B773)', () => {
  it('грузит раздел адреса и просит его данные узла', async () => {
    await preloadSection('/app/account/connections');
    expect(preload).toHaveBeenCalledWith('n03');
  });

  it('чужой адрес ничего не грузит', async () => {
    preload.mockClear();
    await preloadSection('/vacancies');
    expect(preload).not.toHaveBeenCalled();
  });
});
