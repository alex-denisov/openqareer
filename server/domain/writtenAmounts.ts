/** Числительные сумм словами: «двух миллиардов», «twenty-five million». */
const NUMBER_WORDS: readonly (readonly [string, number])[] = [
  ['од(?:ин|на|ного|ной|ному|ним)', 1], ['полтора|полутора|полторы', 1.5], ['дв(?:а|е|ух|ум|умя)', 2],
  ['тр(?:и|[её]х|[её]м|емя)', 3], ['четыр(?:е|[её]х|[её]м|ьмя)', 4], ['пят(?:ь|и|ью)', 5], ['шест(?:ь|и|ью)', 6],
  ['сем(?:ь|и|ью)', 7], ['вос(?:емь|ьми|емью)', 8], ['девят(?:ь|и|ью)', 9], ['десят(?:ь|и|ью)', 10],
  ['одиннадцат(?:ь|и|ью)', 11], ['двенадцат(?:ь|и|ью)', 12], ['тринадцат(?:ь|и|ью)', 13], ['четырнадцат(?:ь|и|ью)', 14],
  ['пятнадцат(?:ь|и|ью)', 15], ['шестнадцат(?:ь|и|ью)', 16], ['семнадцат(?:ь|и|ью)', 17],
  ['восемнадцат(?:ь|и|ью)', 18], ['девятнадцат(?:ь|и|ью)', 19], ['двадцат(?:ь|и|ью)', 20], ['тридцат(?:ь|и|ью)', 30],
  ['сорока?', 40], ['пятьдесят|пятидесяти|пятьюдесятью', 50], ['шестьдесят|шестидесяти|шестьюдесятью', 60],
  ['семьдесят|семидесяти|семьюдесятью', 70], ['восемьдесят|восьмидесяти|восемьюдесятью', 80], ['девяност[оа]', 90],
  ['ст[оа]', 100], ['двести|двухсот|двумстам', 200], ['триста|тр[её]хсот|тр[её]мстам', 300],
  ['четыреста|четыр[её]хсот|четыр[её]мстам', 400], ['пятьсот|пятисот|пятистам', 500], ['шестьсот|шестисот|шестистам', 600],
  ['семьсот|семисот|семистам', 700], ['восемьсот|восьмисот|восьмистам', 800], ['девятьсот|девятисот|девятистам', 900],
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
  ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15], ['sixteen', 16], ['seventeen', 17],
  ['eighteen', 18], ['nineteen', 19], ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60],
  ['seventy', 70], ['eighty', 80], ['ninety', 90], ['hundred', 100],
];
const WORDS = NUMBER_WORDS.map(([word, value]) => ({
  value,
  exact: new RegExp(`^(?:${word})$`, 'iu'),
}));
const WORD = `(?:${NUMBER_WORDS.map(([word]) => word).join('|')})(?!\\p{L})`;
const GAP = String.raw`(?:\s+and\s+|\s*[-–—]\s*|\s+)`;
const SCALE = String.raw`(?:млн|млрд|миллион|миллиард|million|billion)|(?:тыс|thousand)(?:\p{L}*)(?!\p{L})(?!\s+(?:and\s+)?${WORD}|\s+\p{L}+(?:ого|ом|ый|ой)\s+год)`;
const PHRASE = new RegExp(String.raw`(?<!\p{L})${WORD}(?:${GAP}${WORD})*\s+(?=${SCALE})`, 'giu');
const WORD_IN_PHRASE = new RegExp(WORD, 'giu');

const valueOf = (word: string): number => WORDS.find(({ exact }) => exact.test(word))?.value ?? 0;

/** Разряд следующего слова меньше: «двадцать» + «пять», «сто» + «пятьдесят». */
function fits(total: number, next: number): boolean {
  if (next < 10) return total >= 20 && total % 10 === 0;
  return next < 100 && total >= 100 && total % 100 === 0;
}

/** «сто пятьдесят» → 150; «двух-трёх» → диапазон «2–3». */
function digitsOf(phrase: string): string {
  const numbers = (phrase.match(WORD_IN_PHRASE) ?? []).map(valueOf).reduce<readonly number[]>((done, next) => {
    const last = done.at(-1);
    if (last === undefined) return [next];
    if (next === 100 && last < 10) return [...done.slice(0, -1), last * 100];
    return fits(last, next) ? [...done.slice(0, -1), last + next] : [...done, next];
  }, []);
  return `${numbers.join('–')} `;
}

/** Сумма словами — такое же число, как цифрами: «сто пятьдесят миллионов» → «150 миллионов». */
export function withWrittenAmounts(text: string): string {
  return text.replace(PHRASE, digitsOf);
}
