/** Контекст хода консультанта на вкладке «Компании и люди»: выбранная компания (макет 13). */
export interface CompanyCoachRow {
  readonly name: string;
  readonly vacancyCount: number;
  readonly contactsCount: number | null;
  readonly want: boolean;
}

const TITLES_SHOWN = 5;

export function companyCoachContextText(
  company: CompanyCoachRow,
  vacancies: readonly { readonly title: string }[],
): string {
  const titles = vacancies.slice(0, TITLES_SHOWN).map((vacancy) => vacancy.title);
  return [
    'Раздел: Компании и люди',
    `Компания: ${company.name}${company.want ? ' («Хочу в эту компанию»)' : ''}`,
    `Вакансий в подборке: ${company.vacancyCount}${titles.length ? ` — ${titles.join('; ')}` : ''}`,
    company.contactsCount === null
      ? 'Контакты в сети: неизвестно'
      : `Контактов в сети: ${company.contactsCount}`,
  ].join('\n');
}
