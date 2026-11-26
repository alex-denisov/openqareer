/** Вакансии, у которых нажали «Откликнуться»: открытие адреса само нажатием не считается. */
const pressed = new Set<string>();

export function pressApply(vacancyId: string): void {
  pressed.add(vacancyId);
}

export const applyPressed = (vacancyId: string): boolean => pressed.has(vacancyId);

export function forgetApply(vacancyId: string): void {
  pressed.delete(vacancyId);
}

const LETTER_PATH = /\/app\/responses\/([^/?]+)\/letter(?:\?|$)/u;

/** «Отправить» вне экрана отклика — тоже нажатие; в адресе стоит отклик или вакансия. */
export function pressSend(action: { readonly label: string }, path: string): void {
  const id = LETTER_PATH.exec(path)?.[1];
  if (id && action.label === 'Отправить') pressApply(decodeURIComponent(id));
}
