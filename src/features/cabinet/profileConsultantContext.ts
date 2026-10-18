import type { ProfileFocusRequest } from '../resume/profileMobileNavigation';
import type { ResumeDraft } from '../resume/resumeTypes';

export function profileConsultantPrompt(sectionTitle: string, about = false): string {
  return [
    about
      ? 'Помогите собрать проверяемые факты для раздела профиля «Обо мне».'
      : `Помогите мне заполнить раздел профиля «${sectionTitle}».`,
    'Сначала задавайте вопросы и используйте только факты, которые я сообщу или уже подтвердил(а).',
    about
      ? 'Не приписывайте отрасль, масштаб, достижения или метрики без моего подтверждения.'
      : 'Не заполняйте пробелы предположениями; если сведений недостаточно, оставьте их неизвестными.',
    'Перед предложением правки попросите меня подтвердить точную формулировку.',
  ].join(' ');
}

export function experienceFactConsultantContext(
  target: Extract<ProfileFocusRequest, { readonly section: 'experience' }>,
  draft: ResumeDraft | undefined,
): { readonly subjectTitle: string; readonly initialPrompt: string } {
  const entry = target.experienceId
    ? draft?.experience.find((item) => item.id === target.experienceId)
    : undefined;
  const role = [
    target.title?.trim() || entry?.title?.trim(),
    target.employer?.trim() || entry?.employer?.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
  const context = role ? `для места работы «${role}»` : 'для места работы в разделе «Опыт»';
  return {
    subjectTitle: role ? `Опыт: ${role}` : 'Факт об опыте',
    initialPrompt: [
      `Помогите уточнить факт о масштабе команды ${context}.`,
      'Спросите период, конкретные команды и число или диапазон, которым я руководил(а).',
      'Не предполагайте численность. Используйте только мой ответ и попросите подтвердить формулировку перед сохранением в разделе «Опыт».',
    ].join(' '),
  };
}
