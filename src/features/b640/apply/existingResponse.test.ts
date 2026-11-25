import { describe, expect, it } from 'vitest';
import type { ApplicationView } from '../../applications/applicationsApi';
import { existingResponseId } from './existingResponse';

const application = (stage: string) =>
  ({ id: 'r1', clusterId: 'v1', stage }) as unknown as ApplicationView;

describe('повторный отклик на ту же вакансию (B801)', () => {
  it('отправленный отклик открывается вместо нового письма', () => {
    expect(existingResponseId('v1', [application('applied')])).toBe('r1');
    expect(existingResponseId('v1', [application('interview')])).toBe('r1');
  });
  it('черновик, архив, другая вакансия и письмо самого отклика — как раньше', () => {
    expect(existingResponseId('v1', [application('saved')])).toBeNull();
    expect(existingResponseId('v1', [application('archived')])).toBeNull();
    expect(existingResponseId('v2', [application('applied')])).toBeNull();
    expect(existingResponseId('r1', [application('applied')])).toBeNull();
  });
});
