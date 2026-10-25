/** Русские названия служебных кодов проверки навыков (B565): коды не показываются кандидату. */
const SUGGESTION_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  responsibility: 'Ответственность',
  outcome: 'Результат',
  skill: 'Навык',
  preference: 'Предпочтение',
  constraint: 'Ограничение',
  gap: 'Пробел',
  'role-evidence': 'Опыт в роли',
  other: 'Другое',
};

/** Критерии оценки кейса — `CASE_CRITERIA` на сервере. */
const CRITERION_LABELS: Readonly<Record<string, string>> = {
  context: 'Исходные данные и риск',
  actions: 'Порядок действий',
  verification: 'Проверка результата',
};

export function suggestionDomainLabel(domain: string): string {
  return SUGGESTION_DOMAIN_LABELS[domain] ?? 'Другое';
}

export function criterionLabel(criterionId: string): string {
  return CRITERION_LABELS[criterionId] ?? 'Критерий';
}
