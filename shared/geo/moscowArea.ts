import { geoCityNames } from './geoDirectory';

/**
 * «Москва и область» (владелец 04.11). В дереве «Локаций» регион России — федеральный округ, узла
 * области нет, и менять его нельзя: ключи городов уже сохранены в условиях кандидатов. Поэтому это
 * отдельный выбор с перечнем городов данными. «Москва» сама по себе область не включает.
 */
export const MOSCOW_AREA_LABEL = 'Москва и область';

/** Часть Москвы: кто выбрал город, тот ищет и здесь. */
export const MOSCOW_PART_CITIES: readonly string[] = ['Зеленоград'];

/** GeoNames RU.47 (города от 15 000 жителей) и города области, которых там нет; сверено с местами вакансий на проде. */
const MOSCOW_OBLAST_CITIES: readonly string[] = [
  'Московская область', 'Подмосковье', 'Moscow Oblast', 'Moscow Region',
  'Химки', 'Подольск', 'Мытищи', 'Люберцы', 'Балашиха', 'Коломна', 'Электросталь', 'Железнодорожный',
  'Королёв', 'Одинцово', 'Серпухов', 'Орехово-Зуево', 'Ногинск', 'Щёлково', 'Сергиев Посад', 'Пушкино',
  'Жуковский', 'Раменское', 'Красногорск', 'Егорьевск', 'Клин', 'Реутов', 'Воскресенск', 'Чехов',
  'Наро-Фоминск', 'Долгопрудный', 'Солнечногорск', 'Лобня', 'Дмитров', 'Ступино', 'Дубна',
  'Павловский Посад', 'Климовск', 'Домодедово', 'Фрязево', 'Фрязино', 'Видное', 'Ивантеевка',
  'Лыткарино', 'Дзержинский', 'Кашира', 'Протвино', 'Краснознаменск', 'Истра', 'Юбилейный', 'Нахабино',
  'Можайск', 'Ликино-Дулёво', 'Шатура', 'Томилино', 'Дедовск', 'Кубинка', 'Озёры', 'Красноармейск',
  'Волоколамск', 'Зарайск', 'Лосино-Петровский', 'Старая Купавна', 'Рошаль', 'Хотьково', 'Электрогорск',
  'Черноголовка', 'Пущино', 'Электроугли', 'Монино', 'Куровское', 'Сходня', 'Бронницы', 'Малаховка',
  'Котельники', 'Белоозёрский', 'Звенигород', 'Руза', 'Талдом', 'Верея', 'Апрелевка', 'Голицыно',
  'Пересвет', 'Высоковск', 'Краснозаводск', 'Ожерелье', 'Дрезна', 'Яхрома', 'Икша', 'Лотошино',
  'Шаховская', 'Серебряные Пруды', 'Луховицы', 'Дрожжино', 'Щербинка', 'Троицк', 'Коммунарка', 'Михнево', 'Быково',
];

const AREA_CITIES: readonly string[] = ['Москва', ...MOSCOW_PART_CITIES, ...MOSCOW_OBLAST_CITIES];

const key = (name: string) => name.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();

const AREA_KEYS: ReadonlySet<string> = new Set(AREA_CITIES.map(key));

export function isMoscowAreaSelection(value: string | undefined): boolean {
  return value !== undefined && key(value) === key(MOSCOW_AREA_LABEL);
}

const NAMES_OBLAST = /(?<!\p{L})московск\p{L}*\s+област/iu;

/** Город списка или место с пометкой области: «Талдом (Московская область)». */
export function isInMoscowArea(city: string | undefined): boolean {
  return city !== undefined && (AREA_KEYS.has(key(city)) || NAMES_OBLAST.test(city));
}

function spellings(names: readonly string[]): string[] {
  return names.flatMap((name) => [name, ...geoCityNames(name, 'Россия')]);
}

/** Написания города или области для фильтра SQL; другое место — `undefined`. */
export function moscowPlaceSpellings(place: string | undefined): readonly string[] | undefined {
  if (isMoscowAreaSelection(place)) return spellings(AREA_CITIES);
  return place === 'Москва' ? spellings(['Москва', ...MOSCOW_PART_CITIES]) : undefined;
}
