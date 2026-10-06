export interface CompanyReminderDraftInput {
  readonly company?: string | null;
  readonly positionTitle: string;
  readonly promisedDate?: string | null;
  readonly interviewerName?: string | null;
}

function formatDateRu(isoOrDate: string): string {
  const dateStr = isoOrDate.slice(0, 10);
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day}.${month}.${year}`;
  }
  return dateStr;
}

function buildGreeting(interviewerName?: string | null): string {
  if (interviewerName && interviewerName.trim()) {
    return `Здравствуйте, ${interviewerName.trim()}!`;
  }
  return 'Здравствуйте!';
}

function buildTargetPhrase(company?: string | null, positionTitle?: string): string {
  const pos = positionTitle?.trim() || 'позицию';
  const comp = company?.trim();
  if (comp) {
    return `на позицию «${pos}» в компании ${comp}`;
  }
  return `на позицию «${pos}»`;
}

function buildDeadlinePhrase(promisedDate?: string | null): string {
  if (!promisedDate) return '';
  const formatted = formatDateRu(promisedDate);
  return ` Мы договаривались вернуться к диалогу до ${formatted}.`;
}

/**
 * Generates a polite Russian reminder draft for a candidate after an interview,
 * strictly without Anglicisms ("follow-up") and without emoji (B344, B393).
 */
export function generateCompanyReminderDraft(input: CompanyReminderDraftInput): string {
  const greeting = buildGreeting(input.interviewerName);
  const target = buildTargetPhrase(input.company, input.positionTitle);
  const deadline = buildDeadlinePhrase(input.promisedDate);

  return `${greeting}

Хотел уточнить статус по результатам нашего собеседования ${target}.${deadline}

Буду признателен за обратную связь и информацию о дальнейших шагах.

Спасибо!`;
}
