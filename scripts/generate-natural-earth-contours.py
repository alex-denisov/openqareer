#!/usr/bin/env python3
"""Готовит локальные SVG-контуры стран Natural Earth 110m."""

from __future__ import annotations

import argparse
import hashlib
import io
import struct
import zipfile
from datetime import date
from pathlib import Path
from typing import BinaryIO

VIEW_WIDTH = 900
VIEW_HEIGHT = 480
MIN_LATITUDE = -60
MAX_LATITUDE = 85


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_shapes(source: BinaryIO) -> list[str]:
    source.seek(100)
    contours: list[str] = []
    while header := source.read(8):
        _, content_words = struct.unpack('>2i', header)
        content = source.read(content_words * 2)
        shape_type = struct.unpack_from('<i', content, 0)[0]
        if shape_type == 0:
            continue
        if shape_type != 5:
            raise ValueError(f'Ожидался Polygon (5), получен shape type {shape_type}')
        part_count, point_count = struct.unpack_from('<2i', content, 36)
        starts = struct.unpack_from('<' + 'i' * part_count, content, 44)
        point_offset = 44 + part_count * 4
        points = [
            struct.unpack_from('<2d', content, point_offset + index * 16)
            for index in range(point_count)
        ]
        stops = [*starts[1:], point_count]
        rings = [points[start:stop] for start, stop in zip(starts, stops)]
        contours.append(''.join(ring_path(ring) for ring in rings if len(ring) > 2))
    return contours


def ring_path(points: list[tuple[float, float]]) -> str:
    segments: list[list[tuple[float, float]]] = [[points[0]]]
    for first, second in zip(points, points[1:]):
        if abs(first[0] - second[0]) > 180:
            edge_longitude = 180 if first[0] > 0 else -180
            wrapped_longitude = second[0] + (360 if second[0] < 0 else -360)
            fraction = (edge_longitude - first[0]) / (wrapped_longitude - first[0])
            crossing_latitude = first[1] + fraction * (second[1] - first[1])
            segments[-1].append((edge_longitude, crossing_latitude))
            segments.append([(-edge_longitude, crossing_latitude), second])
        else:
            segments[-1].append(second)
    return ''.join(path_for_segment(segment) for segment in segments if len(segment) > 2)


def path_for_segment(points: list[tuple[float, float]]) -> str:
    commands = []
    for index, (longitude, latitude) in enumerate(points):
        x = (longitude + 180) / 360 * VIEW_WIDTH
        y = (MAX_LATITUDE - latitude) / (MAX_LATITUDE - MIN_LATITUDE) * VIEW_HEIGHT
        commands.append(('M' if index == 0 else 'L') + f'{fmt(x)},{fmt(y)}')
    return ''.join(commands) + 'Z'


def fmt(value: float) -> str:
    return f'{value:.1f}'.rstrip('0').rstrip('.')


def write_data(source_zip: Path, output: Path, snapshot_date: str) -> None:
    with zipfile.ZipFile(source_zip) as archive:
        shp_name = next(name for name in archive.namelist() if name.endswith('.shp'))
        version_name = next(name for name in archive.namelist() if name.endswith('.VERSION.txt'))
        version = archive.read(version_name).decode('utf-8').strip()
        contours = read_shapes(io.BytesIO(archive.read(shp_name)))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('w', encoding='utf-8') as target:
        target.write('/**\n')
        target.write(' * Контуры стран Natural Earth Admin 0, масштаб 1:110m.\n')
        target.write(f' * Версия набора: {version}; проекция equirectangular: 900×480, широта от -60° до 85°.\n')
        target.write(' * Источник: https://naturalearth.s3.amazonaws.com/110m_cultural/ne_110m_admin_0_countries.zip.\n')
        target.write(' * Лицензия: общественное достояние (public domain), атрибуция не требуется.\n')
        target.write(f' * Выгрузка: {snapshot_date}; SHA-256 ZIP: {sha256(source_zip)}.\n')
        target.write(' * Данные хранятся локально и не загружаются из сети во время работы.\n')
        target.write(' */\n')
        target.write('export const NATURAL_EARTH_COUNTRY_CONTOURS: readonly string[] = [\n')
        for contour in contours:
            target.write(f"  '{contour}',\n")
        target.write('];\n')
    print(f'countries={len(contours)} output={output} sha256={sha256(source_zip)}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Официальный ZIP Natural Earth 110m')
    parser.add_argument('--output', type=Path, default=Path('src/features/vacancies/naturalEarth110m.ts'))
    parser.add_argument('--snapshot-date', default=date.today().isoformat())
    args = parser.parse_args()
    write_data(args.source, args.output, args.snapshot_date)


if __name__ == '__main__':
    main()
