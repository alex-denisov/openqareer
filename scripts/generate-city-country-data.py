"""Собирает server/vacancies/vacancyCountry/cityCountryData.ts из GeoNames cities5000.txt (CC BY 4.0).

Источник: https://download.geonames.org/export/dump/cities5000.zip
Запуск: python3 scripts/generate-city-country-data.py cities5000.txt
"""

import base64
import collections
import gzip
import re
import sys
import unicodedata
from pathlib import Path

TARGET = Path("server/vacancies/vacancyCountry/cityCountryData.ts")
MIN_POPULATION = 5_000
# Чужие написания берём только у крупных городов: иначе словарь растёт втрое.
ALIAS_POPULATION = 100_000
ALIAS_WEIGHT = 0.3
# Тёзка в другой стране крупнее четверти: имя двусмысленное, в словарь не входит.
DOMINANCE = 4
MIN_LENGTH = 4
# Одно слово в словаре — только город от 15 тыс.; внутри строки («+») — от 50 тыс.
WORD_POPULATION = 15_000
TEXT_POPULATION = 50_000
CHUNK = 1200
ALIAS = re.compile(r"[A-Za-z\u00c0-\u024f'’. -]+|[А-Яа-яЁё. -]+")


Names = dict[str, dict[str, float]]


def read(path: str) -> tuple[Names, Names]:
    best: Names = collections.defaultdict(dict)
    largest: Names = collections.defaultdict(dict)
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        field = line.split("\t")
        population, country = int(field[14] or 0), field[8]
        if population < MIN_POPULATION or not country:
            continue
        names = {field[1], field[2]}
        aliases = (
            {alias for alias in field[3].split(",") if ALIAS.fullmatch(alias)}
            if population >= ALIAS_POPULATION
            else set()
        )
        for name in names | aliases:
            key = unicodedata.normalize("NFC", name).lower().strip()
            if len(key) < MIN_LENGTH or key.isdigit():
                continue
            weight = population * (1 if name in names else ALIAS_WEIGHT)
            best[key][country] = max(best[key].get(country, 0), weight)
            largest[key][country] = max(largest[key].get(country, 0), population)
    return best, largest


def namesakes(best: Names, largest: Names) -> dict[str, list[str]]:
    """Тёзки: имя → все страны, от крупнейшего города. Читаются только рядом с кодом штата («Cambridge, MA»)."""
    result: dict[str, list[str]] = collections.defaultdict(list)
    for key, countries in best.items():
        ranked = sorted(countries.items(), key=lambda item: -item[1])
        if len(ranked) < 2 or not {"US", "CA"} & countries.keys():
            if "IN" not in countries or len(ranked) < 2:
                continue
        known = [code for code in countries if largest[key][code] >= WORD_POPULATION]
        codes = sorted(known, key=lambda code: (-largest[key][code], code))
        if codes:
            result["~" + ",".join(codes)].append(key)
    return result


def unambiguous(best: Names, largest: Names) -> dict[str, list[str]]:
    result: dict[str, list[str]] = collections.defaultdict(list)
    for key, countries in best.items():
        ranked = sorted(countries.items(), key=lambda item: -item[1])
        if len(ranked) > 1 and ranked[0][1] < DOMINANCE * ranked[1][1]:
            continue
        country = ranked[0][0]
        population = largest[key][country]
        if " " not in key and "-" not in key and population < WORD_POPULATION:
            continue
        result[f"{country}+" if population >= TEXT_POPULATION else country].append(key)
    return result


def main() -> None:
    best, largest = read(sys.argv[1])
    rows = {**unambiguous(best, largest), **namesakes(best, largest)}
    text = "\n".join(f"{code}|{'|'.join(sorted(names))}" for code, names in sorted(rows.items()))
    data = base64.b64encode(gzip.compress(text.encode(), 9, mtime=0)).decode()
    chunks = "".join(f"  '{data[at:at + CHUNK]}',\n" for at in range(0, len(data), CHUNK))
    TARGET.write_text(
        "// Собирает scripts/generate-city-country-data.py из GeoNames cities5000 (CC BY 4.0). Руками не править.\n"
        f"export const CITY_COUNTRY_GZIP_BASE64: readonly string[] = [\n{chunks}];\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
