import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CandidateCompanyOpportunity } from '../../../shared/candidateCompany';
import { WANT_COMPANY_EFFECT, WantControls } from './CompanyDetailPanel';

const company = (want: boolean) =>
  ({ key: 'k', name: 'Acme', want }) as CandidateCompanyOpportunity;

describe('B422: что делает отметка «Хочу в эту компанию»', () => {
  it('подсказка на кнопке и на отметке говорит про подбор и письмо', () => {
    expect(WANT_COMPANY_EFFECT).toBe(
      'Вакансии компании — первыми в подборке по соответствию, а письмо скажет, что вы хотите именно сюда',
    );
    for (const want of [false, true]) {
      const html = renderToStaticMarkup(
        <WantControls company={company(want)} busy={false} onToggle={vi.fn()} />,
      );
      expect(html).toContain(`title="${WANT_COMPANY_EFFECT}"`);
    }
  });
});
