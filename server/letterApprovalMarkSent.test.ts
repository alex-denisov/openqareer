import { describe, expect, it } from 'vitest';
import { setup } from './testHelpers/letterApprovalHarness';

/**
 * B716: отклик ушёл вне приложения — «Я уже откликнулся» поднимает ту же заявку, что создало
 * одобрение письма, а не заводит вторую: черновик и «Одобрить письмо» в «Сегодня» уходят.
 */
describe('B716: отметка отклика после одобренного письма', () => {
  it('одобренная заявка становится откликом, вторая не появляется', async () => {
    const { approve, candidates, candidateId } = await setup('Senior Platform Engineer');
    const approved = await approve();
    expect(approved.statusCode).toBe(200);
    const applicationId = approved.json().data.applicationId as string;
    const before = candidates.listApplications(candidateId).find((item) => item.id === applicationId);
    expect(before?.stage).toBe('saved');

    candidates.recordVacancyApplication(candidateId, {
      clusterId: 'cluster-99',
      status: 'applied',
      vacancy: { title: 'Senior Platform Engineer', company: 'Acme', url: 'https://hh.ru/vacancy/139180469', source: 'hh' },
    } as never);

    const items = candidates.listApplications(candidateId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: applicationId, stage: 'applied' });
    expect(items[0]?.whoseTurn).not.toBe('candidate');
  });
});
