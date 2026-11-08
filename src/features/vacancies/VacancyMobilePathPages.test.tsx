import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VacancyConnectionCircles } from './vacancyLetterApi';
import { PushCirclePage } from './VacancyMobilePathPages';

function circles(resume?: VacancyConnectionCircles['resume']): VacancyConnectionCircles {
  return {
    vacancyId: 'cluster-1',
    companyKey: 'genetec',
    companyName: 'Genetec',
    vacancyTitle: 'Business Information Architect',
    circles: [],
    ...(resume ? { resume } : {}),
    linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
  };
}

const page = (data: VacancyConnectionCircles) =>
  renderToStaticMarkup(<PushCirclePage page="c3" data={data} />);

describe('мобильная страница круга 3: строка резюме (B601, 08.11)', () => {
  it('Basic и выше: резюме под вакансию прикрепится при одобрении', () => {
    const html = page(circles({ available: true, kind: 'targeted' }));
    expect(html).toContain('Резюме под вакансию');
    expect(html).toContain('Резюме под вакансию прикрепится при одобрении письма');
  });

  it('Free: «Резюме», общее резюме прикрепится', () => {
    const html = page(circles({ available: true, kind: 'master' }));
    expect(html).toContain('<b>Резюме</b>');
    expect(html).toContain('Общее резюме прикрепится при одобрении письма');
  });

  it('опыта нет: отклик уйдёт без резюме', () => {
    expect(page(circles({ available: false, kind: 'targeted' }))).toContain(
      'В профиле нет опыта работы: отклик уйдёт без резюме, письмо об этом не упоминает',
    );
  });

  it('сервер не прислал признак: только заголовок, без обещаний', () => {
    const html = page(circles());
    expect(html).toContain('Резюме под вакансию');
    expect(html).not.toContain('прикрепится');
  });
});
