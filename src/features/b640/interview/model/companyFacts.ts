import type { B640CompanyItem } from '../../../../../shared/b640Companies';
import type { VacancyApplicationSnapshot } from '../../../../../shared/vacancyApplication';

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
  /** Вакансия, сохранённая в отклике: для компании вне подборки. */
  readonly snapshot?: {
    readonly vacancy: VacancyApplicationSnapshot;
    readonly savedAt: string;
  } | null;
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

/** Первое предложение описания, где компания названа по имени. */
function aboutSentence(company: string, description: string): string | null {
  const name = company.toLocaleLowerCase('ru-RU');
  const sentences = description.split(/(?<=[.!?…])\s+|\n+/u).map((item) => item.trim());
  return sentences.find((item) => item.toLocaleLowerCase('ru-RU').includes(name)) ?? null;
}

/** Компании нет в подборке: то, что сохранено в самом отклике. */
function snapshotFacts(snapshot: CompanyFactsInput['snapshot']): CompanyFacts {
  const company = snapshot?.vacancy.companyHidden ? '' : (snapshot?.vacancy.company ?? '').trim();
  if (!snapshot || !company) return { rows: [], source: null };
  const { vacancy } = snapshot;
  const about = aboutSentence(company, vacancy.description ?? '');
  const rows: CompanyFactRow[] = [
    { label: 'Компания', value: company },
    ...(about ? [{ label: 'В вакансии', value: about }] : []),
  ];
  return { rows, source: `Из вакансии, сохранённой в отклике ${dayMonth(snapshot.savedAt)}.` };
}

export function companyFacts({ company, clusterId, snapshot }: CompanyFactsInput): CompanyFacts {
  if (!company) return snapshotFacts(snapshot);
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
  if (rows.length === 0) return snapshotFacts(snapshot);
  return { rows, source: sourceLine(company.sources) };
}
