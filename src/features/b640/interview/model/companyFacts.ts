import type { B640CompanyItem } from '../../../../../shared/b640Companies';

/** Только то, что платформа хранит о компании; новости до B391 не показываются. */
export interface CompanyFactsInput {
  readonly company:
    | (Pick<B640CompanyItem, 'industry' | 'location' | 'sources'> & {
        readonly recruiters: readonly {
          readonly vacancyId: string;
          readonly fullName: string;
          readonly roleTitle: string;
        }[];
      })
    | null;
  /** Вакансия отклика: рекрутер другой вакансии компании не «ведёт» эту. */
  readonly clusterId: string | null;
}

export interface CompanyFactRow {
  readonly label: string;
  readonly value: string;
}

export interface CompanyFacts {
  readonly rows: readonly CompanyFactRow[];
  readonly source: string | null;
}

function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(iso));
}

function sourceLine(sources: NonNullable<CompanyFactsInput['company']>['sources']): string | null {
  const dated = sources.filter((item) => !Number.isNaN(Date.parse(item.observedAt)));
  if (dated.length === 0) return null;
  const latest = dated.reduce((a, b) =>
    Date.parse(b.observedAt) > Date.parse(a.observedAt) ? b : a,
  );
  const names = [...new Set(dated.map((item) => item.name))].join(', ');
  return `Из карточки компании на платформе: ${names}, ${dayMonth(latest.observedAt)}.`;
}

export function companyFacts({ company, clusterId }: CompanyFactsInput): CompanyFacts {
  if (!company) return { rows: [], source: null };
  const rows: CompanyFactRow[] = [];
  const about = [company.industry, company.location].filter(Boolean).join(', ');
  if (about) rows.push({ label: 'Чем занята', value: about });
  const hiring = clusterId
    ? company.recruiters.find((item) => item.vacancyId === clusterId)
    : undefined;
  if (hiring?.fullName) {
    const value = [hiring.fullName, hiring.roleTitle].filter(Boolean).join(', ');
    rows.push({ label: 'Кто ведёт', value });
  }
  return { rows, source: rows.length > 0 ? sourceLine(company.sources) : null };
}
