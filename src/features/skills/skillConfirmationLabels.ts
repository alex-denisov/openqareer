import type { SkillQuizLevel } from './skillConfirmationApi';

export const SKILL_QUIZ_LEVELS: readonly { readonly id: SkillQuizLevel; readonly label: string }[] =
  [
    { id: 'junior', label: 'Начальный' },
    { id: 'middle', label: 'Средний' },
    { id: 'senior', label: 'Продвинутый' },
  ];

export const SKILL_CONFIRM_EXPLANATION =
  'Покажите, что вы это умеете: пройдите короткий тест или разберите свой опыт в беседе с консультантом. Это ваша проверка, а не сертификат. Работодатель её не увидит, зато у вас будут точные формулировки с цифрами для отклика и готовность к вопросам на интервью.';

export const SKILL_CONFIRM_DISCLAIMER = 'Проверка openqareer, не сертификат';

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export function discussPrompt(skillName: string): string {
  return `Помогите разобрать мой опыт с навыком «${skillName}»: задайте вопросы про реальные задачи и результаты с цифрами.`;
}
