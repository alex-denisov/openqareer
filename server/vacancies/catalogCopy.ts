/** «1 вакансия», «24 вакансии», «155 000 вакансий» — число с верным склонением. */
export function countLabel(value: number): string {
  const tens = value % 100;
  const ones = value % 10;
  const word =
    tens >= 11 && tens <= 14
      ? 'вакансий'
      : ones === 1
        ? 'вакансия'
        : ones >= 2 && ones <= 4
          ? 'вакансии'
          : 'вакансий';
  return `${value.toLocaleString('ru-RU').replace(/ /gu, ' ')} ${word}`;
}
