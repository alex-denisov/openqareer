#!/usr/bin/env python3
"""Собирает локальный справочник городов из выгрузки GeoNames."""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import unicodedata
import zipfile
from datetime import date
from pathlib import Path

CHUNK_SIZE = 1024


def has_latin_or_cyrillic_name(name: str) -> bool:
    letters = [char for char in name if unicodedata.category(char).startswith('L')]
    scripts = [unicodedata.name(char, '') for char in letters]
    return bool(letters) and all('LATIN' in script or 'CYRILLIC' in script for script in scripts)


def read_cities(path: Path) -> list[list[object]]:
    cities: list[list[object]] = []
    with zipfile.ZipFile(path) as archive:
        with archive.open(archive.namelist()[0]) as source:
            for raw in source:
                fields = raw.decode('utf-8').rstrip('\n').split('\t')
                if len(fields) <= 14 or not fields[14].isdigit() or int(fields[14]) < 100_000:
                    continue
                names = {fields[1], fields[2]}
                for name in fields[3].split(','):
                    if has_latin_or_cyrillic_name(name):
                        names.add(name)
                if fields[1] == 'Saint Petersburg' and fields[8] == 'RU':
                    names.update({'СПб', 'Питер'})
                names.discard('')
                cities.append([fields[8], float(fields[4]), float(fields[5]), sorted(names)])
    return cities


def read_countries(path: Path) -> list[list[str]]:
    countries: list[list[str]] = []
    with path.open(encoding='utf-8') as source:
        for raw in source:
            if not raw.strip() or raw.startswith('#'):
                continue
            fields = raw.rstrip('\n').split('\t')
            if len(fields) > 4 and fields[0] and fields[1] and fields[4]:
                countries.append([fields[0], fields[1], fields[4]])
    return countries


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_data(
    output: Path,
    cities_path: Path,
    countries_path: Path,
    snapshot_date: str,
) -> None:
    cities = read_cities(cities_path)
    countries = read_countries(countries_path)
    payload = json.dumps(
        {'cities': cities, 'countries': countries},
        ensure_ascii=False,
        separators=(',', ':'),
    ).encode('utf-8')
    encoded = base64.b64encode(gzip.compress(payload, compresslevel=9, mtime=0)).decode('ascii')
    chunks = [encoded[index : index + CHUNK_SIZE] for index in range(0, len(encoded), CHUNK_SIZE)]
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open('w', encoding='utf-8') as target:
        target.write('/**\n')
        target.write(' * Городской справочник GeoNames: записи cities15000 с населением от 100000 жителей.\n')
        target.write(' * Сохранены координаты, код страны и варианты названий Latin/Cyrillic; СПб добавлен как частый вариант.\n')
        target.write(' * Источник: https://download.geonames.org/export/dump/cities15000.zip и countryInfo.txt.\n')
        target.write(' * Лицензия: Creative Commons Attribution 4.0 (CC BY 4.0), атрибуция GeoNames.\n')
        target.write(f' * Выгрузка: {snapshot_date}; данные сжаты gzip и не загружаются из сети во время работы.\n')
        target.write(f' * SHA-256 cities15000.zip: {sha256(cities_path)}\n')
        target.write(f' * SHA-256 countryInfo.txt: {sha256(countries_path)}\n')
        target.write(' */\n')
        target.write('export const GEONAMES_CITY_DATA_GZIP_BASE64: readonly string[] = [\n')
        for chunk in chunks:
            target.write(f"  '{chunk}',\n")
        target.write('];\n')

    print(f'cities={len(cities)} countries={len(countries)} output={output} lines={len(chunks) + 11}')
    print(f'cities15000.sha256={sha256(cities_path)}')
    print(f'countryInfo.sha256={sha256(countries_path)}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cities', type=Path, required=True, help='Путь к официальному cities15000.zip')
    parser.add_argument('--countries', type=Path, required=True, help='Путь к официальному countryInfo.txt')
    parser.add_argument('--output', type=Path, default=Path('server/domain/geonamesCityData.ts'))
    parser.add_argument('--snapshot-date', default=date.today().isoformat())
    args = parser.parse_args()
    write_data(args.output, args.cities, args.countries, args.snapshot_date)


if __name__ == '__main__':
    main()
