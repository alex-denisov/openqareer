/** Программы, чьё название кончается словом должности: «Google Tag Manager» — навык. */
const TOOL =
  /(?:^|\s)(?:tag|solution|configuration|endpoint|package|password|campaign|ads?|business|secrets?|task|window|file|virtual machine)\s+manager$/iu;
const ENGLISH =
  /(?:^|[\s/-])(?:manager|engineer|developer|architect|analyst|designer|director|officer|scientist|consultant|specialist|administrator|lead|president|recruiter|coordinator|programmer|tester|product owner|scrum master)s?$/iu;
const LEADERSHIP =
  /^(?:head|director|vp|svp|evp|vice president|chief|manager|lead)(?:\s+of|,|\s+\p{L}+\s+officer)(?!\p{L})/iu;
const SHORT = /^(?:ceo|cto|cio|coo|cfo|cpo|cmo|ciso|cdo|vp|svp|evp|team lead)$/iu;
const RUSSIAN =
  /^(?:(?:старш|главн|ведущ|младш|техническ|генеральн|исполнительн|коммерческ|финансов|операционн)\p{L}*\s+)*(?:руководитель|директор|менеджер|инженер|разработчик|архитектор|аналитик|дизайнер|специалист|администратор|программист|тестировщик|консультант|начальник|тимлид)(?!\p{L})/iu;

/** Строка — название должности, а не навык. */
export function isJobTitle(text: string): boolean {
  const name = text.trim();
  if (TOOL.test(name)) return false;
  return [ENGLISH, LEADERSHIP, SHORT, RUSSIAN].some((pattern) => pattern.test(name));
}
