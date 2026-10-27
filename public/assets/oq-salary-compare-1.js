/* B351 06a: where a typed salary sits in the lead city's quartiles. Local only: nothing is sent or stored. */
export function compareSalary(value, p25, p50, p75, money) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < p25)
    return [
      'Ниже, чем в 3 из 4 вакансий.',
      `Четверть вакансий платит меньше ${money(p25)} — есть смысл просить больше.`,
    ];
  if (value < p50) return ['В нижней половине рынка.', `Медиана вилок — ${money(p50)}.`];
  if (value <= p75)
    return [
      'В верхней половине рынка.',
      `Выше медианы ${money(p50)}, но четверть вакансий платит больше ${money(p75)}.`,
    ];
  return [
    'Выше, чем в 3 из 4 вакансий.',
    `Больше ${money(p75)} платит четверть вакансий с вилкой.`,
  ];
}
const SIGN = { RUR: '₽', RUB: '₽', USD: '$', EUR: '€', KZT: '₸' };
const box =
  typeof document === 'undefined' ? null : document.querySelector('[data-salary-compare]');
if (box) {
  const input = box.querySelector('input');
  const out = box.querySelector('[aria-live]');
  const empty = out.textContent;
  const [p25, p50, p75] = ['p25', 'p50', 'p75'].map((key) => Number(box.dataset[key]));
  const sign = SIGN[box.dataset.currency] ?? box.dataset.currency;
  const money = (v) => `${Math.round(v).toLocaleString('ru-RU').replace(/\s/gu, ' ')} ${sign}`;
  input.addEventListener('input', () => {
    const result = compareSalary(
      Number.parseInt(input.value.replace(/\D/gu, ''), 10),
      p25,
      p50,
      p75,
      money,
    );
    out.replaceChildren();
    if (!result) {
      out.textContent = empty;
      return;
    }
    const strong = document.createElement('b');
    strong.textContent = result[0];
    out.append(strong, ` ${result[1]}`);
  });
}
