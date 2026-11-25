/** Вакансии, которые кандидат уже видел в списке: название известно до ответа сервера (B798). */
export interface KnownVacancy {
  readonly vacancyId: string;
  readonly title: string;
  readonly company: string;
}

const LIMIT = 2000;
const known = new Map<string, KnownVacancy>();

/** `id` — адрес отклика: id вакансии или id самого отклика. */
export function rememberVacancy(id: string, vacancy: KnownVacancy): void {
  if (!vacancy.title) return;
  known.delete(id);
  known.set(id, vacancy);
  if (known.size > LIMIT) known.delete(known.keys().next().value as string);
}

export function knownVacancy(id: string): KnownVacancy | null {
  return known.get(id) ?? null;
}

export function rememberClusters(
  items: readonly {
    readonly cluster: {
      readonly id: string;
      readonly canonicalTitle: string;
      readonly canonicalCompany?: string | null;
    };
  }[],
): void {
  for (const { cluster } of items) {
    rememberVacancy(cluster.id, {
      vacancyId: cluster.id,
      title: cluster.canonicalTitle,
      company: cluster.canonicalCompany ?? '',
    });
  }
}

/** «Название · компания». */
export function vacancyName({ title, company }: Pick<KnownVacancy, 'title' | 'company'>): string {
  return [title, company].filter(Boolean).join(' · ');
}
