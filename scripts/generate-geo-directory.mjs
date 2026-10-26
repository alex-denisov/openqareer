#!/usr/bin/env node
/**
 * Собирает справочник географии `shared/geo/geoDirectory.json` (B-geo, 27.10).
 *
 * Источники (лицензии позволяют хранить выгрузку в репозитории):
 * - GeoNames, CC BY 4.0: cities15000.txt, countryInfo.txt, admin1CodesASCII.txt,
 *   alternateNamesV2.txt (русские и английские названия) — https://download.geonames.org/export/dump/
 * - Unicode CLDR (через ICU в Node, `Intl.DisplayNames('ru')`), Unicode License v3 — русские названия стран.
 *
 * Города: все с населением от 100 000, все города России и соседних стран
 * от 15 000 и каждый город, которым начинается строка места вакансии в пуле
 * (`--pool`, JSON [{location, n}] из catalog_entries прода).
 *
 * Запуск: node scripts/generate-geo-directory.mjs --geonames <dir> [--pool <json>]
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const NEAR_COUNTRIES = new Set('RU BY KZ UZ KG TJ TM AM GE AZ MD RS ME CY TR AE IL'.split(' '));
const BIG_CITY = 100_000;
const MAX_ALIASES = 3;

/** Федеральные округа по кодам субъектов GeoNames (Указ Президента РФ № 849 с изменениями 2018 г.). */
const RU_DISTRICT_SUBJECTS = {
  'Центральный ФО': '09 10 83 86 21 25 37 41 43 48 47 56 62 69 72 77 76 88',
  'Северо-Западный ФО': '28 34 06 50 85 23 66 42 49 52 60',
  'Южный ФО': '01 24 38 07 84 61',
  'Северо-Кавказский ФО': '17 19 22 27 68 12 70',
  'Приволжский ФО': '08 45 46 73 80 16 90 33 51 55 57 65 67 81',
  'Уральский ФО': '40 71 78 13 32 87',
  'Сибирский ФО': '03 79 31 04 91 20 29 53 54 75',
  'Дальневосточный ФО': '11 63 93 92 59 30 05 44 64 89 15',
};

function args() {
  const out = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i += 2) out[list[i].replace(/^--/, '')] = list[i + 1];
  if (!out.geonames) throw new Error('--geonames <dir> is required');
  return out;
}

const lower = (value) => value.toLocaleLowerCase('ru-RU').trim();
const tsv = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'));

function readCountries(dir) {
  const ru = new Intl.DisplayNames(['ru'], { type: 'region' });
  return tsv(join(dir, 'countryInfo.txt')).map((f) => ({
    iso: f[0],
    iso3: f[1],
    en: f[4],
    ruCldr: ru.of(f[0]),
  }));
}

function readCities(dir) {
  return tsv(join(dir, 'cities15000.txt')).map((f) => ({
    id: f[0],
    name: f[1],
    ascii: f[2],
    alt: f[3] ? f[3].split(',') : [],
    cc: f[8],
    admin1: f[10],
    pop: Number(f[14]) || 0,
    fcode: f[7],
  }));
}

/** Русские и английские названия из alternateNamesV2 для нужных geonameid. */
async function readAltNames(dir, ids) {
  const names = new Map();
  const lines = createInterface({ input: createReadStream(join(dir, 'alternateNamesV2.txt')) });
  for await (const line of lines) {
    const f = line.split('\t');
    if (f[2] !== 'ru' && f[2] !== 'en') continue;
    if (!ids.has(f[1]) || f[7] === '1' || f[6] === '1') continue;
    const entry = names.get(f[1]) ?? { ru: [], en: [] };
    entry[f[2]].push({ name: f[3], preferred: f[4] === '1', short: f[5] === '1' });
    names.set(f[1], entry);
  }
  return names;
}

const pickRu = (list = []) =>
  (list.find((n) => n.preferred && !n.short) ?? list.find((n) => !n.short) ?? list[0])?.name;

function poolHeads(poolPath) {
  if (!poolPath) return [];
  return JSON.parse(readFileSync(poolPath, 'utf8')).map(({ location, n }) => {
    const parts = location
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return { head: lower(parts[0] ?? ''), rest: parts.slice(1).map(lower), n };
  });
}

function countryMaps(countries, ownCountry) {
  const label = new Map(
    countries.map((c) => [c.iso, ownCountry[c.iso.toLowerCase()] ?? c.ruCldr ?? c.en]),
  );
  const alias = new Map();
  for (const c of countries)
    for (const name of [c.iso, c.iso3, c.en, c.ruCldr, label.get(c.iso)])
      if (name) alias.set(lower(name), c.iso);
  return { label, alias };
}

/** Город для каждой строки места пула: по написанию, при подсказке страны — в ней, иначе крупнейший. */
function matchPool(cities, countryAlias, pool) {
  const byName = new Map();
  for (const city of cities)
    for (const name of new Set([city.name, city.ascii, ...city.alt])) {
      const key = lower(name);
      if (key) byName.set(key, [...(byName.get(key) ?? []), city]);
    }
  const matched = new Map();
  let vacancies = 0;
  for (const { head, rest, n } of poolHeads(pool)) {
    const found = byName.get(head);
    if (!found) continue;
    const isoHint = rest.map((p) => countryAlias.get(p)).find(Boolean);
    const candidates = isoHint ? found.filter((c) => c.cc === isoHint) : found;
    const best = [...(candidates.length ? candidates : found)].sort((a, b) => b.pop - a.pop)[0];
    vacancies += n;
    matched.set(best.id, new Set([...(matched.get(best.id) ?? []), head]));
  }
  return { matched, vacancies };
}

function regionLabeler(admin1, alt) {
  return (cc, code) => {
    if (cc === 'RU')
      return Object.entries(RU_DISTRICT_SUBJECTS).find(([, list]) =>
        list.split(' ').includes(code),
      )?.[0];
    const row = admin1.get(`${cc}.${code}`);
    return row ? (pickRu(alt.get(row[3])?.ru) ?? row[1]) : undefined;
  };
}

function cityRows(chosen, alt, poolMatched, regionLabel) {
  const regions = {};
  const rows = [...chosen]
    .sort((a, b) => b.pop - a.pop)
    .map((c) => {
      const names = alt.get(c.id);
      const ru = pickRu(names?.ru) ?? c.name;
      const region = regionLabel(c.cc, c.admin1);
      if (region) regions[`${c.cc}.${c.admin1}`] = region;
      // Написания из пула первыми: по ним сводятся места вакансий.
      const aliases = [
        ...(poolMatched.get(c.id) ?? []),
        c.name,
        c.ascii,
        ...(names?.en ?? []).map((n) => n.name),
      ];
      const unique = [...new Set(aliases.map(lower))].filter((a) => a && a !== lower(ru));
      return [ru, c.cc, c.admin1, c.pop, ...unique.slice(0, MAX_ALIASES)];
    });
  return { rows, regions };
}

async function main() {
  const { geonames: dir, pool, output = 'shared/geo/geoDirectory.json' } = args();
  const countries = readCountries(dir);
  const own = await import('../shared/locationGazetteer.ts');
  const cities = readCities(dir);
  const admin1 = new Map(tsv(join(dir, 'admin1CodesASCII.txt')).map((f) => [f[0], f]));
  const ids = new Set([...cities.map((c) => c.id), ...[...admin1.values()].map((f) => f[3])]);
  const alt = await readAltNames(dir, ids);
  const country = countryMaps(countries, own.COUNTRY_NAMES);
  const poolMatch = matchPool(cities, country.alias, pool);
  const chosen = cities.filter(
    (c) =>
      c.pop >= BIG_CITY ||
      (NEAR_COUNTRIES.has(c.cc) && !c.fcode.startsWith('PPLX')) ||
      poolMatch.matched.has(c.id),
  );
  const { rows, regions } = cityRows(chosen, alt, poolMatch.matched, regionLabeler(admin1, alt));
  const data = {
    source:
      'GeoNames (CC BY 4.0, https://www.geonames.org) cities15000/countryInfo/admin1CodesASCII/alternateNamesV2; ' +
      'названия стран — Unicode CLDR (Unicode License v3) через ICU',
    snapshot: new Date().toISOString().slice(0, 10),
    countries: countries.map((c) =>
      [c.iso, country.label.get(c.iso), c.en, c.iso3, c.ruCldr].filter(
        (v, i, all) => v && all.indexOf(v) === i,
      ),
    ),
    regions,
    cities: rows,
  };
  writeFileSync(output, JSON.stringify(data));
  const summary = {
    countries: data.countries.length,
    cities: rows.length,
    citiesInCountries: new Set(rows.map((c) => c[1])).size,
    regions: Object.keys(regions).length,
    poolCities: poolMatch.matched.size,
    poolVacanciesMatched: poolMatch.vacancies,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

await main();
