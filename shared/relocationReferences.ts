/** Первичные справочники: это ссылки для проверки конкретной цены, не средняя аренда страны. */
export const relocationHousingReferences: Readonly<Record<string, { title: string; url: string; scope: string }>> = {
  DE: { title: 'Berlin Mietspiegel 2026', url: 'https://mietspiegel.berlin.de/berliner-mietspiegel/erlaeuterungen-zum-mietspiegel/vorbemerkungen/', scope: 'Берлин, сопоставимая холодная аренда по типу жилья; коммунальные услуги отдельно.' },
  CY: { title: 'CYSTAT', url: 'https://www.cystat.gov.cy/en/subthemestatistics?Id=47', scope: 'Индексы цен; не месячная аренда. Нужна цена конкретного жилья.' },
  RS: { title: 'Статистика бюджета домохозяйств Сербии', url: 'https://www.stat.gov.rs/en-us/oblasti/potrosnja-prihodi-i-uslovi-zivota/potrosnja-domacinstva/', scope: 'Расходы домохозяйств, не цена аренды для нового резидента.' },
  AE: { title: 'Dubai Land Department Rental Index', url: 'https://dubailand.gov.ae/en/eservices/rental-index/rental-index/', scope: 'Дубай: адрес, тип и размер жилья; годовую сумму переведите в месячный эквивалент.' },
  GE: { title: 'GEOSTAT, цены на жильё', url: 'https://www.geostat.ge/en/modules/categories/698/residential-property-price-index', scope: 'Индекс стоимости недвижимости не является ценой аренды.' },
  RU: { title: 'Росстат: цены', url: 'https://rosstat.gov.ru/statistics/price', scope: 'Проверяйте город, тип жилья и месяц наблюдения.' },
};
