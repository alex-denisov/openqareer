import type { B640ContactMessageKind } from '../../shared/b640ContactMessage';

/**
 * B753 (решение CPO 23.11): черновик кончается просьбой или «Буду рад обсудить»; строка вроде
 * «С уважением к вашему времени» — подпись, её снимаем целиком. Предложения не режем.
 */
const COURTESY_LINE =
  /^(с уважением|с наилучшими пожеланиями|с благодарностью|спасибо за (ваше )?время|благодарю за (ваше )?время|best regards|kind regards|regards|sincerely|thank you for your time)\b[^\n]*$|^[^\n]{0,40}к вашему времени[.!]?$/iu;

export function dropCourtesyClosing(text: string): string {
  const lines = text.trim().split('\n');
  while (lines.length > 1 && (lines.at(-1)!.trim() === '' || COURTESY_LINE.test(lines.at(-1)!.trim()))) lines.pop();
  return lines.join('\n').trim();
}

interface EnglishFacts {
  readonly kind: B640ContactMessageKind;
  readonly recipientName: string;
  readonly recipientCompany: string;
  readonly vacancyTitle?: string;
  readonly vacancyCompany?: string;
}

/** Запасной текст английского черновика: только имя, вакансия и компания. */
export function englishFallbackMessage(facts: EnglishFacts & { readonly targetRole: string }): string {
  const name = facts.recipientName.trim().split(/\s+/u)[0] ?? '';
  const greeting = name ? `Hello ${name}!` : 'Hello!';
  const company = facts.vacancyCompany || facts.recipientCompany;
  const role = facts.vacancyTitle ? `the ${facts.vacancyTitle} role${company ? ` at ${company}` : ''}` : `opportunities${company ? ` at ${company}` : ''}`;
  if (facts.kind === 'recruiter') {
    return `${greeting} I am interested in ${role}. I would be glad to tell you briefly about my experience. Would you be open to a short call?`;
  }
  return `${greeting} I am exploring ${role}. Would you be able to recommend me or tell me a little about the team?`;
}
