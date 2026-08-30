import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TargetVacancyHeader } from './ResumeTargetVacanciesBlock';
import type { MatchedVacancyItem } from '../coach/coachApi';
import { EMPLOYER_NOT_NAMED } from '../../../shared/employerLabel';

/**
 * Telegram posts often name no employer at all. The pool used to write the
 * invented «IT Company» there; now the field is empty, and the card has to say
 * so instead of printing a blank next to a middle dot (B164).
 */
function itemWithCompany(company: string): MatchedVacancyItem {
  return {
    cluster: {
      id: 'cluster-tg-11',
      canonicalTitle: 'Senior React разработчик',
      canonicalCompany: company,
      canonicalLocation: '',
      isRemote: true,
      descriptionSummary: 'Продуктовая команда, React и TypeScript.',
      skills: ['React'],
      primaryUrl: 'https://t.me/job_react/11',
      sources: [
        {
          sourceType: 'telegram',
          sourceId: 'src-tg-react',
          sourceUrl: 'https://t.me/job_react/11',
          observedAt: '2026-08-30T12:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-08-30T10:00:00.000Z',
      lastSeenAt: '2026-08-30T12:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      matchScore: 72,
      fitLevel: 'good',
      matchingPoints: ['React'],
      missingPoints: [],
    },
  } as unknown as MatchedVacancyItem;
}

describe('target vacancy card employer line', () => {
  it('says the employer is not named when the source never named one', () => {
    const html = renderToStaticMarkup(<TargetVacancyHeader item={itemWithCompany('')} />);
    expect(html).toContain(EMPLOYER_NOT_NAMED);
  });

  it('prints the employer the source did name', () => {
    const html = renderToStaticMarkup(<TargetVacancyHeader item={itemWithCompany('МТС Банк')} />);
    expect(html).toContain('МТС Банк');
    expect(html).not.toContain(EMPLOYER_NOT_NAMED);
  });
});
