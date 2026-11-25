/** Вакансии, у которых нажали «Откликнуться»: открытие адреса само нажатием не считается. */
const pressed = new Set<string>();

export function pressApply(vacancyId: string): void {
  pressed.add(vacancyId);
}

export const applyPressed = (vacancyId: string): boolean => pressed.has(vacancyId);

export function forgetApply(vacancyId: string): void {
  pressed.delete(vacancyId);
}
