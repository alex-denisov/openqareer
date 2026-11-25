import { describe, expect, it } from 'vitest';
import type { ApplicationStage } from '../../shared/applicationStage';
import { findSentApplication } from './sentApplication';

const URL = 'https://boards.example/jobs/1';
const card = (id: string, clusterId: string, stage: ApplicationStage, title = 'CTO', url = URL) => ({
  id,
  clusterId,
  stage,
  vacancy: { title, url },
});
const lookup = { clusterId: 'cluster-x', title: 'CTO', urls: [`${URL}/#apply`] };

describe('отправленный отклик на ту же вакансию (B801)', () => {
  it('находит по id строки, по кластеру и по объявлению; черновик-дубль не мешает', () => {
    const draft = card('d', 'cluster-x', 'saved');
    expect(findSentApplication([draft, card('a', 'x', 'applied')], lookup)?.id).toBe('a');
    expect(findSentApplication([draft, card('b', 'other', 'interview')], lookup)?.id).toBe('b');
  });

  it('черновик, архив, другое название и другой адрес — не отправленный отклик', () => {
    const list = [
      card('a', 'cluster-x', 'saved'),
      card('b', 'x', 'archived'),
      card('c', 'other', 'applied', 'CFO'),
      card('d', 'other-2', 'applied', 'CTO', 'https://boards.example/jobs/2'),
    ];
    expect(findSentApplication(list, lookup)).toBeUndefined();
  });
});
