/**
 * Чужая сфера в названии (B794, владелец 25.11). Функция роли у «Технического директора
 * (строительство)» та же, что у CTO, у «службы эксплуатации зданий» — та же, что у ИТ-эксплуатации:
 * словарь функций их не разводит, сферу называет само название.
 */
const word = (body: string): RegExp => new RegExp(`(?<!\\p{L})(?:${body})`, 'iu');

/** ИТ названо прямо: ИТ-директор ресторанного холдинга или клиники остаётся своим. */
const IT_NAMED = word(
  String.raw`(?:it|ит|ikt|ict|cio|erp|crm|devops|sre|saas|ai|ии|ml|data|цод)(?!\p{L})|1[сc](?!\p{L})|информацион|программн|software|digital|цифров|cyber|кибер|network|сетевой инфраструктур|сервер|системного админ|инсталляц|автоматизированн\p{L}* систем|безопасности информации|инфраструктурн\p{L}* процесс|information (?:technology|systems?)|technology`,
);

interface Sector {
  readonly title: RegExp;
  /** Сфера перевешивает и прямое упоминание ИТ: «ЭОМ на строительство ЦОД» — стройка. */
  readonly overIt?: true;
}

const SECTORS: readonly Sector[] = [
  {
    title: word(
      String.raw`строительств|строительн|благоустройств|электромонтаж|монтажн|отделк\p{L}* квартир|пгс(?!\p{L})|овик(?!\p{L})|электрическ|construction|fit-out|roads?(?!\p{L})|traffic|electrical`,
    ),
  },
  {
    title: word(String.raw`на строительство|овик(?!\p{L})|холодоснабж|кондиционир|кондиционер`),
    overIt: true,
  },
  {
    title: word(
      String.raw`зданий|сооружени|инженерных систем|инженерной инфраструктур|коммерческ\p{L}* недвижимост|жил\p{L}* недвижимост|недвижимост|жкх(?!\p{L})|мкд(?!\p{L})|противопожар|пожарн|вентиляц|холодоснабж|кондиционир|клининг|facility|facilities|property|landscaping|lounges`,
    ),
  },
  {
    title: word(
      String.raw`кондитер|пищев|хлебозавод|суши|кофе|бар(?:ов|а)(?!\p{L})|ресторан|кафе(?!\p{L})|общепит|готовая еда|корма(?!\p{L})|агро|сельхоз|животновод|птицевод|хладокомбинат`,
    ),
  },
  {
    title: word(
      String.raw`завод(?!\p{L}*ск)|фабрик|пищевого производств|станкостро|спецтехник|гидроэлектро|грузов|автомобил|колонн|транспорт|трубопровод|бпла(?!\p{L})|fleet|tanker|aviation|aerospace|aircraft|hull|automotive|3pl|engine maintenance|railway`,
    ),
  },
  {
    title: word(
      String.raw`клиник|медицинск|стоматолог|протез|зуботехн|фармац|clinical|pharmacovigilance|hospital|healthcare|claims|enrollment|coding operations`,
    ),
  },
  {
    title: word(
      String.raw`кредитн\p{L}* риск|коллекторск|waterpark|field operations|site operations`,
    ),
  },
];

/** Эксплуатация без слова «ИТ» — здания, транспорт и оборудование. */
const OPERATION_OF_PREMISES = word(String.raw`эксплуатаци`);

/** Инженер объекта: в ИТ эти должности называют иначе. */
const PLANT_ENGINEER = word(
  String.raw`главн\p{L}* (?:инженер|энергетик|конструктор)|(?:deputy )?chief engineer(?!ing)`,
);

const namesSector = (sector: Sector, title: string): boolean =>
  sector.title.test(title) && (sector.overIt === true || !IT_NAMED.test(title));

const RULES: readonly Sector[] = [
  ...SECTORS,
  { title: OPERATION_OF_PREMISES },
  { title: PLANT_ENGINEER },
];

/** Кандидат из ИТ: в его ролях есть ИТ, разработка или CTO. */
const IT_ROLE = word(String.raw`cto(?!\p{L})|разработ|devops`);

/**
 * Решает только для кандидата из ИТ, чьи роли сферу не называют. «Операционный директор» без ИТ в
 * ролях мог работать в любой сфере, а главный инженер — в зданиях: им названия не скрываются.
 */
export function isForeignSectorTitle(title: string, targetRoles: readonly string[]): boolean {
  const fromIt = targetRoles.some((role) => IT_NAMED.test(role) || IT_ROLE.test(role));
  if (!fromIt || targetRoles.some((role) => RULES.some((sector) => sector.title.test(role)))) {
    return false;
  }
  return RULES.some((sector) => namesSector(sector, title));
}
