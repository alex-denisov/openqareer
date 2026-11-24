import { describe, expect, it, vi } from 'vitest';
import { VARIANT_RETRY_BUDGET_MS, writeCheckedVariant, type OnVariantReject, type RetryableVariantRequest } from './checkedVariant';

const request: RetryableVariantRequest & { readonly avoid: string[] } = { avoid: [] };
const check = (output: { text: string }, onReject: OnVariantReject) => {
  if (output.text === 'good') return output.text;
  onReject('unknown_fact');
  return null;
};

describe('B682: отклонённый проверкой вариант пишется заново с причиной', () => {
  it('вторая попытка знает прежний ответ и причину; принятый текст уходит кандидату', async () => {
    const write = vi.fn(async (input: RetryableVariantRequest) => ({ text: input.rejected ? 'good' : 'bad' }));
    const onReject = vi.fn();
    expect(await writeCheckedVariant({ request, write, check, onReject })).toBe('good');
    expect(write.mock.calls[0]![0].rejected).toBeUndefined();
    expect(write.mock.calls[1]![0].rejected).toEqual({ text: 'bad', reason: expect.stringContaining('factIds') });
    expect(onReject.mock.calls).toEqual([['unknown_fact', 1]]);
  });

  it('не больше трёх попыток; проверка не ослабевает', async () => {
    const write = vi.fn(async () => ({ text: 'bad' }));
    expect(await writeCheckedVariant({ request, write, check })).toBeNull();
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('модели не ответили — повтора нет', async () => {
    const write = vi.fn(async () => null);
    expect(await writeCheckedVariant({ request, write, check })).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('медленный ответ: новая попытка за сроком не начинается', async () => {
    let clock = 0;
    const write = vi.fn(async () => { clock += VARIANT_RETRY_BUDGET_MS; return { text: 'bad' }; });
    expect(await writeCheckedVariant({ request, write, check, now: () => clock })).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
