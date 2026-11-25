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
CHUNK = 1200
ALIAS = re.compile(r"[A-Za-z\u00c0-\u024f'’. -]+|[А-Яа-яЁё. -]+")


def read(path: str) -> dict[str, dict[str, float]]:
    best: dict[str, dict[str, float]] = collections.defaultdict(dict)
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
    return best


def unambiguous(best: dict[str, dict[str, float]]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = collections.defaultdict(list)
    for key, countries in best.items():
        ranked = sorted(countries.items(), key=lambda item: -item[1])
        if len(ranked) > 1 and ranked[0][1] < DOMINANCE * ranked[1][1]:
            continue
        result[ranked[0][0]].append(key)
    return result


def main() -> None:
    rows = unambiguous(read(sys.argv[1]))
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
