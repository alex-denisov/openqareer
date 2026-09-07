/**
 * Названия стран и слова, которыми площадки заменяют место работы.
 *
 * B203: карта считает хабы по городам, и страна или «Hybrid» в этом списке
 * раздувает счёт и обещает точку там, где её нет. Правило одно на сервер и на
 * экран, поэтому список живёт в общем слое. Здесь только имена: координаты
 * остаются в справочнике сервера и приписываются лишь там, где измерены.
 */
const COUNTRY_NAMES: ReadonlySet<string> = new Set([
  'нидерланды',
  'netherlands',
  'германия',
  'germany',
  'великобритания',
  'uk',
  'армения',
  'armenia',
  'сербия',
  'serbia',
  'кипр',
  'cyprus',
  'грузия',
  'georgia',
  'оаэ',
  'uae',
  'сша',
  'usa',
  'казахстан',
  'kazakhstan',
  'польша',
  'poland',
  'португалия',
  'portugal',
  'испания',
  'spain',
  'франция',
  'france',
  'argentina',
  'australia',
  'austria',
  'azerbaijan',
  'belarus',
  'belgium',
  'brazil',
  'bulgaria',
  'canada',
  'chile',
  'china',
  'czechia',
  'denmark',
  'estonia',
  'finland',
  'greece',
  'hungary',
  'india',
  'indonesia',
  'ireland',
  'israel',
  'italy',
  'japan',
  'latvia',
  'lithuania',
  'malaysia',
  'mexico',
  'norway',
  'philippines',
  'romania',
  'russia',
  'singapore',
  'sweden',
  'switzerland',
  'thailand',
  'turkey',
  'ukraine',
  'unitedarabemirates',
  'unitedkingdom',
  'unitedstates',
  'uzbekistan',
  'vietnam',
  'австралия',
  'австрия',
  'азербайджан',
  'аргентина',
  'беларусь',
  'бельгия',
  'болгария',
  'бразилия',
  'венгрия',
  'вьетнам',
  'греция',
  'дания',
  'израиль',
  'индия',
  'индонезия',
  'ирландия',
  'италия',
  'канада',
  'китай',
  'латвия',
  'литва',
  'малайзия',
  'мексика',
  'норвегия',
  'россия',
  'румыния',
  'сингапур',
  'таиланд',
  'турция',
  'узбекистан',
  'украина',
  'филиппины',
  'финляндия',
  'чехия',
  'чили',
  'швейцария',
  'швеция',
  'эстония',
  'япония',
]);

function normalizeNameKey(value?: string): string {
  return (value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function isCountryName(label?: string): boolean {
  const key = normalizeNameKey(label);
  return key.length > 0 && COUNTRY_NAMES.has(key);
}

/** Надрегиональные ярлыки площадок: местом на карте они не являются. */
const REGION_LABELS: ReadonlySet<string> = new Set([
  // Коды, которыми площадки записывают «страна целиком»: города за ними нет.
  'us',
  'eu',
  'emea',
  'apac',
  'latam',
  'amer',
  'americas',
  'europe',
  'европа',
  'asia',
  'азия',
  'africa',
  'африка',
  'worldwide',
  'global',
  'anywhere',
  'distributed',
  'homeoffice',
  'hybrid',
  'onsite',
  'remote',
  'удалённо',
  'удаленно',
  'гибрид',
]);

export function isRegionLabel(label?: string): boolean {
  const key = normalizeNameKey(label);
  return key.length > 0 && REGION_LABELS.has(key);
}

/**
 * Английское имя города для публичного адреса (B209).
 *
 * Правило владельца запрещает транслит: «Москва» должна стать `moscow`, а не
 * `moskva`. Имя собственное не выводится по правилам — его надо знать, поэтому
 * здесь список, а не алгоритм. Список пополняется по живому пулу: город,
 * которого в нём нет, **не получает публичной страницы**, и это честнее, чем
 * выдать транслит и нарушить правило.
 */
const CITY_LATIN_NAMES: Readonly<Record<string, string>> = {
  москва: 'moscow',
  санктпетербург: 'saint-petersburg',
  петербург: 'saint-petersburg',
  спб: 'saint-petersburg',
  новосибирск: 'novosibirsk',
  екатеринбург: 'yekaterinburg',
  казань: 'kazan',
  нижнийновгород: 'nizhny-novgorod',
  воронеж: 'voronezh',
  краснодар: 'krasnodar',
  самара: 'samara',
  ростовнадону: 'rostov-on-don',
  уфа: 'ufa',
  пермь: 'perm',
  красноярск: 'krasnoyarsk',
  тюмень: 'tyumen',
  челябинск: 'chelyabinsk',
  омск: 'omsk',
  волгоград: 'volgograd',
  саратов: 'saratov',
  тольятти: 'tolyatti',
  ижевск: 'izhevsk',
  иннополис: 'innopolis',
  минск: 'minsk',
  алматы: 'almaty',
  астана: 'astana',
  ташкент: 'tashkent',
  бишкек: 'bishkek',
  тбилиси: 'tbilisi',
  батуми: 'batumi',
  ереван: 'yerevan',
  баку: 'baku',
  белград: 'belgrade',
  подгорица: 'podgorica',
  лиссабон: 'lisbon',
  порту: 'porto',
  берлин: 'berlin',
  мюнхен: 'munich',
  гамбург: 'hamburg',
  лондон: 'london',
  амстердам: 'amsterdam',
  роттердам: 'rotterdam',
  париж: 'paris',
  барселона: 'barcelona',
  мадрид: 'madrid',
  варшава: 'warsaw',
  краков: 'krakow',
  прага: 'prague',
  вильнюс: 'vilnius',
  рига: 'riga',
  таллин: 'tallinn',
  хельсинки: 'helsinki',
  стамбул: 'istanbul',
  дубай: 'dubai',
  абудаби: 'abu-dhabi',
  тельавив: 'tel-aviv',
  лимассол: 'limassol',
  никосия: 'nicosia',
  бангкок: 'bangkok',
  сингапур: 'singapore',
  ньюйорк: 'new-york',
  сангфранциско: 'san-francisco',
  санфранциско: 'san-francisco',
};

/** Сегменты адреса, занятые каталогом: городом они быть не могут. */
const RESERVED_CITY_SLUGS = new Set(['job', 'page', 'remote']);

/**
 * Слова, по которым видно, что в поле места стоит не город, а способ работы
 * или надрегион. Найдено на живом пуле 2026-09-07: продукт печатал публичные
 * адреса `/vacancies/anywhere-in-france`, `/vacancies/global-remote`,
 * `/vacancies/in-office`, `/vacancies/remote-texas`.
 *
 * Сравнение идёт по целым словам, поэтому «Regina» и «Offenbach» остаются
 * городами: срезать по вхождению подстроки значило бы переименовать город.
 */
const NON_CITY_WORDS = new Set([
  'anywhere',
  'worldwide',
  'global',
  'nationwide',
  'office',
  'remote',
  'hybrid',
  'onsite',
  'region',
  'regional',
  'countrywide',
  'locations',
  'various',
  'multiple',
  'in',
  'across',
  'select',
]);

/**
 * Слова, которые делают строку адресом здания или улицы, а не города. Ловятся
 * только в конце: «St Petersburg» начинается с «St», и запрет по вхождению
 * стёр бы настоящий город (живой пул 2026-09-07).
 */
const STREET_TAIL_WORDS = new Set([
  'building',
  'street',
  'st',
  'road',
  'rd',
  'avenue',
  'ave',
  'boulevard',
  'blvd',
  'tower',
  'floor',
  'suite',
  'plaza',
]);

/** Известные написания одного города: иначе один город получит два адреса. */
const CITY_SLUG_ALIASES: Readonly<Record<string, string>> = {
  'new-york-city': 'new-york',
  nyc: 'new-york',
  'saint-petersburg-russia': 'saint-petersburg',
  'washington-dc': 'washington',
};

const LATIN_LABEL = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/u;

export function latinCityName(label?: string): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (!trimmed) return undefined;
  // Страна и надрегион городом не становятся: у них нет городской страницы,
  // а счёт по ним — уже другой счёт (B203).
  if (isCountryName(trimmed) || isRegionLabel(trimmed)) return undefined;

  const key = normalizeNameKey(trimmed);
  const named = CITY_LATIN_NAMES[key];
  if (named) return RESERVED_CITY_SLUGS.has(named) ? undefined : named;

  const latin = trimmed.toLowerCase().replace(/[\s-]+/gu, ' ').trim();
  if (!LATIN_LABEL.test(latin.replace(/ /gu, '-'))) return undefined;
  // Способ работы и надрегион городом не становятся, даже когда написаны
  // латиницей и выглядят как имя собственное.
  const words = latin.split(' ');
  if (words.some((word) => NON_CITY_WORDS.has(word))) return undefined;
  if (words.length > 1 && STREET_TAIL_WORDS.has(words[words.length - 1]!)) return undefined;

  const slug = CITY_SLUG_ALIASES[latin.replace(/ /gu, '-')] ?? latin.replace(/ /gu, '-');
  return RESERVED_CITY_SLUGS.has(slug) ? undefined : slug;
}
