import { describe, expect, it } from 'vitest';
import { setup } from './testHelpers/letterApprovalHarness';

describe('B711: одобренное письмо читается после ухода с экрана', () => {
  it('без одобрения — null', async () => {
    const { readApproval } = await setup('Head of Platform');
    const response = await readApproval();
    expect(response.statusCode).toBe(200);
    expect(response.json().data.approval).toBeNull();
  });

  it('возвращает последнее одобрение вакансии: текст, вариант и резюме', async () => {
    const { approve, readApproval } = await setup('Head of Platform');
    await approve({ body: 'Первый текст письма.' });
    const second = (
      await approve({ body: 'Второй вариант письма.', subject: 'Тема', variantId: 'variant-2' })
    ).json().data;
    const read = (await readApproval()).json().data.approval;
    expect(read).toEqual({
      applicationId: second.applicationId,
      documentId: second.documentId,
      approvedAt: second.approvedAt,
      status: 'approved',
      sent: false,
      resume: second.resume,
      subject: 'Тема',
      body: 'Второй вариант письма.',
      variantId: 'variant-2',
    });
    expect(read.resume).toMatchObject({ kind: 'targeted' });
  });

  it('одобрение другой вакансии не возвращается', async () => {
    const { approve, readApproval } = await setup('Head of Platform');
    await approve();
    expect((await readApproval('cluster-other')).json().data.approval).toBeNull();
  });
});
