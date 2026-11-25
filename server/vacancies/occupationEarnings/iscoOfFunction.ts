/**
 * B803: крупная группа ISCO-08 для функции таксономии. Заработок ILOSTAT есть только по крупным
 * группам, поэтому точность всегда низкая. Руководители (Head и выше) — группа 1.
 */
export type IscoGroup = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'TOTAL';

const MANAGER_RANK = 2;

const FUNCTION_GROUPS: Readonly<Record<string, IscoGroup>> = {
  eng: '2',
  'eng-mgmt': '1',
  'ai-ml': '2',
  data: '2',
  qa: '2',
  design: '2',
  product: '2',
  research: '2',
  education: '2',
  legal: '2',
  finance: '2',
  hr: '2',
  marketing: '2',
  pr: '2',
  consulting: '2',
  'audit-risk': '2',
  security: '2',
  'arts-culture': '2',
  media: '2',
  healthcare: '2',
  bizdev: '2',
  'project-mgmt': '2',
  'it-ops': '3',
  procurement: '3',
  'public-service': '3',
  'real-estate': '3',
  sales: '3',
  ops: '3',
  admin: '4',
  support: '4',
  retail: '5',
  hospitality: '5',
  'personal-services': '5',
  'security-services': '5',
  agriculture: '6',
  construction: '7',
  'extraction-energy': '7',
  manufacturing: '8',
  logistics: '8',
  'elementary-labor': '9',
  'exec-general': '1',
};

/** Функция вне таблицы («other», «defense») — средняя по всем занятиям. */
export function iscoOfFunction(functionCode: string, levelRank: number | null): IscoGroup {
  if ((levelRank ?? 0) >= MANAGER_RANK) return '1';
  return FUNCTION_GROUPS[functionCode] ?? 'TOTAL';
}
