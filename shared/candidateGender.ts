import { FEMALE_FIRST_NAMES, MALE_FIRST_NAMES } from './personFirstNames';

/**
 * Род кандидата для письма по имени и фамилии из профиля (решение владельца, 06.11). Нового поля и
 * вопроса нет. Порядок: известное имя, отчество, русская фамилия. Если признаки расходятся или их нет,
 * рода нет: письмо пишется без указания рода, а не наугад. Неоднозначные имена (Саша, Alex) решает только
 * фамилия или отчество.
 */
export type CandidateGender = 'male' | 'female';

const FOREIGN_MALE = [
  'alexey', 'alexei', 'aleksei', 'aleksey', 'alexander', 'aleksandr', 'andrey', 'andrei', 'anton', 'artem', 'artyom',
  'boris', 'denis', 'dmitry', 'dmitri', 'dmitrii', 'evgeny', 'evgenii', 'yevgeny', 'georgy', 'grigory', 'igor', 'ilya',
  'ivan', 'kirill', 'konstantin', 'leonid', 'maxim', 'maksim', 'mikhail', 'nikolay', 'nikolai', 'oleg', 'pavel',
  'pyotr', 'roman', 'ruslan', 'sergey', 'sergei', 'stanislav', 'timur', 'vadim', 'valery', 'vasily', 'viktor',
  'vitaly', 'vladimir', 'vladislav', 'vyacheslav', 'yaroslav', 'yuri', 'yury',
  'adam', 'alan', 'albert', 'andrew', 'anthony', 'arthur', 'benjamin', 'brian', 'carl', 'carlos', 'charles', 'daniel',
  'david', 'diego', 'edward', 'eric', 'francisco', 'frank', 'george', 'hans', 'harry', 'henry', 'jack', 'jacob', 'james',
  'javier', 'john', 'jonathan', 'jose', 'joseph', 'juan', 'justin', 'kevin', 'klaus', 'lars', 'lucas', 'luis', 'marco',
  'mark', 'martin', 'matthew', 'michael', 'nicholas', 'oliver', 'patrick', 'paul', 'pedro', 'peter', 'philip', 'richard',
  'robert', 'ryan', 'samuel', 'scott', 'stephen', 'steven', 'thomas', 'tim', 'timothy', 'tom', 'victor', 'william',
  'ahmed', 'ahmad', 'ali', 'hassan', 'hussein', 'ibrahim', 'khalid', 'mohamed', 'mohammad', 'mohammed', 'muhammad',
  'omar', 'yusuf', 'rajesh', 'rahul', 'amit', 'vikram',
  'азамат', 'айдар', 'ахмед', 'бахтияр', 'джон', 'ибрагим', 'майкл', 'магомед', 'мухаммад', 'рашид', 'ринат', 'рустам',
  'тимур', 'фарид', 'шамиль', 'эльдар',
];
const FOREIGN_FEMALE = [
  'alena', 'alina', 'anastasia', 'anastasiya', 'anna', 'daria', 'darya', 'ekaterina', 'yekaterina', 'elena', 'yelena',
  'evgenia', 'galina', 'irina', 'julia', 'kristina', 'ksenia', 'larisa', 'lyudmila', 'marina', 'maria', 'natalia',
  'natalya', 'nadezhda', 'oksana', 'olga', 'polina', 'svetlana', 'tatiana', 'tatyana', 'valentina', 'vera', 'veronika',
  'victoria', 'viktoria', 'yana', 'yulia',
  'alice', 'amanda', 'amy', 'angela', 'ann', 'barbara', 'carla', 'carmen', 'catherine', 'charlotte', 'christine',
  'claire', 'diana', 'elizabeth', 'emily', 'emma', 'eva', 'francesca', 'hannah', 'helen', 'isabel', 'jane', 'jennifer',
  'jessica', 'kate', 'katherine', 'laura', 'linda', 'lisa', 'lucia', 'mary', 'megan', 'michelle', 'monica',
  'nancy', 'nicole', 'olivia', 'rachel', 'rebecca', 'sandra', 'sarah', 'sofia', 'sophia', 'sophie', 'susan',
  'aisha', 'amina', 'fatima', 'layla', 'leila', 'mariam', 'priya', 'zainab',
  'айгуль', 'айша', 'гульнара', 'гульнур', 'дженнифер', 'динара', 'лейла', 'мадина', 'сабина', 'фатима', 'эльмира',
];
/** Имена обоих родов: решить может только фамилия или отчество. */
const AMBIGUOUS = new Set([
  'саша', 'женя', 'валя', 'шура', 'слава', 'алекс', 'крис', 'ким', 'андреа', 'мишель', 'джейми', 'робин', 'карен',
  'alex', 'sasha', 'zhenya', 'chris', 'sam', 'taylor', 'jordan', 'casey', 'morgan', 'robin', 'kim', 'lee', 'andrea',
  'karen', 'nikita', 'jean', 'alexis', 'ashley', 'jamie', 'dana', 'pat', 'wei', 'yu', 'min',
]);

const normalize = (value: string): string => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
const MALE = new Set([...MALE_FIRST_NAMES, ...FOREIGN_MALE].map(normalize));
const FEMALE = new Set([...FEMALE_FIRST_NAMES, ...FOREIGN_FEMALE].map(normalize));

const FEMALE_PATRONYMIC = /(?:овна|евна|ична|инична|кызы|гызы)$/u;
const MALE_PATRONYMIC = /(?:ович|евич|оглы|улы)$/u;
const FEMALE_SURNAME = /(?:ова|ева|ская|цкая|ovna|ova|eva|skaya|tskaya)$/u;
const MALE_SURNAME = /(?:ов|ев|ский|цкий|ov|ev|sky|skiy|skii|tsky)$/u;
const MIN_PATRONYMIC_LENGTH = 5;

function tokensOf(fullName: string): string[] {
  return fullName.trim().split(/\s+/u).filter(Boolean).map(normalize);
}

/** Один род среди признаков; пусто или вперемешку — признака нет. */
function single(signs: readonly CandidateGender[]): CandidateGender | undefined {
  const [first] = signs;
  return first && signs.every((sign) => sign === first) ? first : undefined;
}

function nameSigns(tokens: readonly string[]): CandidateGender[] {
  return tokens.flatMap((token): CandidateGender[] => {
    if (AMBIGUOUS.has(token)) return [];
    if (MALE.has(token)) return ['male'];
    return FEMALE.has(token) ? ['female'] : [];
  });
}

/** Мужское имя часто бывает фамилией («Анна Герман», «Emma Martin»), женское почти никогда. */
function nameSign(signs: readonly CandidateGender[]): CandidateGender[] {
  if (signs.length === 0) return [];
  return [signs.includes('female') ? 'female' : 'male'];
}

/** «-ович» бывает и фамилией обоих родов («Анна Абрамович»): считается только среди трёх слов и в середине. */
function patronymicSigns(tokens: readonly string[]): CandidateGender[] {
  return tokens.flatMap((token, index): CandidateGender[] => {
    if (token.length < MIN_PATRONYMIC_LENGTH && !/^(?:кызы|гызы|оглы)$/u.test(token)) return [];
    if (FEMALE_PATRONYMIC.test(token)) return ['female'];
    const middle = tokens.length >= 3 && index > 0 && index < tokens.length - 1;
    const particle = /^(?:оглы|улы)$/u.test(token);
    return MALE_PATRONYMIC.test(token) && (middle || particle) ? ['male'] : [];
  });
}

/** -ин и -ина не считаются: «Мартин», «Щербина» и им подобные бывают у обоих родов, ошибка хуже нейтрального письма. */
function surnameSigns(tokens: readonly string[]): CandidateGender[] {
  if (tokens.length < 2) return [];
  return tokens.flatMap((token): CandidateGender[] => {
    if (FEMALE_SURNAME.test(token)) return ['female'];
    return MALE_SURNAME.test(token) ? ['male'] : [];
  });
}

export function candidateGenderFromName(fullName: string | undefined): CandidateGender | undefined {
  const tokens = tokensOf(fullName ?? '');
  const names = nameSigns(tokens);
  const patronymics = patronymicSigns(tokens);
  if (patronymics.length > 0) return single([...nameSign(names), ...patronymics]);
  if (names.length > 0) return nameSign(names)[0];
  return single(surnameSigns(tokens));
}
