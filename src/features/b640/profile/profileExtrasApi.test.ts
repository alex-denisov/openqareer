import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../../coach/apiClient';
import {
  getIncome,
  incomeAmount,
  incomeLabel,
  PHOTO_MAX_BYTES,
  photoFileError,
  reapplyChange,
  removePhoto,
  saveIncome,
  uploadPhoto,
} from './profileExtrasApi';

const reply = (data: unknown): Response => new Response(JSON.stringify({ data }), { status: 200 });
const json = { 'Content-Type': 'application/json' };

describe('b640 profile: клиент фото, дохода и повтора правки', () => {
  afterEach(() => vi.restoreAllMocks());

  it('отправляет фото содержимым файла, без имени и типа', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(reply({ photoMediaId: 'abc' }));
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], '../evil.jpg', {
      type: 'text/html',
    });
    await expect(uploadPhoto(file)).resolves.toEqual({ photoMediaId: 'abc' });
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/profile/photo', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ contentBase64: '/9j/AA==' }),
    });
  });

  it('убирает фото, читает и сохраняет доход, возвращает отменённую правку', async () => {
    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockImplementation(async () => reply({ current: 1, expected: null }));
    await removePhoto();
    expect(spy).toHaveBeenLastCalledWith('/api/v1/candidate/profile/photo', { method: 'DELETE' });
    const controller = new AbortController();
    await expect(getIncome(controller.signal)).resolves.toEqual({ current: 1, expected: null });
    expect(spy).toHaveBeenLastCalledWith('/api/v1/candidate/profile/income', {
      signal: controller.signal,
    });
    await saveIncome({ current: 440_000, expected: null });
    expect(spy).toHaveBeenLastCalledWith('/api/v1/candidate/profile/income', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ current: 440_000, expected: null }),
    });
    await reapplyChange('ch 1');
    expect(spy).toHaveBeenLastCalledWith('/api/v1/candidate/profile/history/ch%201/reapply', {
      method: 'POST',
    });
  });

  it('слишком тяжёлый файл не отправляет', () => {
    expect(photoFileError({ size: PHOTO_MAX_BYTES + 1 })).toBe('Фото больше 5 МБ.');
    expect(photoFileError({ size: PHOTO_MAX_BYTES })).toBeNull();
    expect(photoFileError({ size: 0 })).toBe('Подойдёт фото в JPEG или PNG.');
  });

  it('сумму читает из ввода с пробелами; пусто — «не указано»; мусор — ошибка', () => {
    expect(incomeAmount('440 000')).toBe(440_000);
    expect(incomeAmount(' 440 000 ₽ ')).toBe(440_000);
    expect(incomeAmount('')).toBeNull();
    expect(incomeAmount('много')).toBe('invalid');
    expect(incomeAmount('0')).toBe('invalid');
    expect(incomeAmount('1000000000')).toBe('invalid');
  });

  it('сумму показывает с разрядами', () => {
    expect(incomeLabel(440_000)).toBe('440 000 ₽ на руки');
    expect(incomeLabel(null)).toBeNull();
  });
});
