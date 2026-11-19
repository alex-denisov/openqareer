import { describe, expect, it, vi } from 'vitest';
import { classifyRecheck, recheckFindingUrl } from './findingRecheck';

describe('B382: повторная проверка одной находки', () => {
  it('404 и 410 — страница удалена; 200 — на месте; прочее — неясно', () => {
    expect(classifyRecheck(404)).toBe('removed');
    expect(classifyRecheck(410)).toBe('removed');
    expect(classifyRecheck(200)).toBe('still_there');
    expect(classifyRecheck(301)).toBe('unclear');
    expect(classifyRecheck(403)).toBe('unclear');
    expect(classifyRecheck(503)).toBe('unclear');
  });

  it('ходит по адресу находки одним GET через закреплённый fetch', async () => {
    const fetch = vi.fn(async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }));
    await expect(recheckFindingUrl('https://board.test/ad/1', fetch)).resolves.toBe('removed');
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://board.test/ad/1', method: 'GET' }),
    );
  });

  it('не http(s) и сбой сети — «неясно», чужие схемы не запрашиваются', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('blocked');
    });
    await expect(recheckFindingUrl('file:///etc/passwd', fetch)).resolves.toBe('unclear');
    await expect(recheckFindingUrl('не адрес', fetch)).resolves.toBe('unclear');
    expect(fetch).not.toHaveBeenCalled();
    await expect(recheckFindingUrl('https://board.test/ad/1', fetch)).resolves.toBe('unclear');
  });
});
