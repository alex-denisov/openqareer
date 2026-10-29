/**
 * hh.ru prints its driving-licence block and the «Дополнительная информация»
 * heading right after the skills, so every reader can take them for skills
 * (Blinov, 27.10). The server import checks this for every reader, the rules
 * parser before it.
 */
const NOT_A_SKILL =
  /^(?:опыт вождения|имеется собственный автомобиль|права категории|дополнительная информация)/iu;

export function isNotASkill(value: string): boolean {
  return NOT_A_SKILL.test(value.trim());
}
