import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { kpiWeightSum } from '../../shared/careerDiaryKpi';
import { groundKpiRows, parseKpiModelAnswer, type KpiModelRow } from './kpiImport';
import { tableToText } from './kpiTable';

const SOURCE =
  'Релиз — не дольше недели к концу января, вес 30 %. 2 вакансии закрыть до 28.02, вес 30 %. ' +
  'Инциденты после релиза — не больше 2 в месяц к концу квартала. Год: 95 % релизов без отката. Поставил директор.';

const row = (patch: Partial<KpiModelRow>): KpiModelRow => ({
  title: 'Закрыто вакансий',
  target: '2',
  targetValue: 2,
  unit: 'шт.',
  dueDate: '2027-02-28',
  horizon: 'quarter',
  weight: 30,
  setBy: 'manager',
  quote: '2 вакансии закрыть до 28.02, вес 30 %',
  ...patch,
});

describe('groundKpiRows: ничего не додумывается', () => {
  it('строка с цитатой из источника остаётся целиком', () => {
    const [kept] = groundKpiRows([row({})], SOURCE);
    expect(kept).toMatchObject({
      id: 'r1',
      title: 'Закрыто вакансий',
      targetValue: 2,
      weight: 30,
      setBy: 'manager',
    });
  });

  it('строка без опоры в источнике отбрасывается', () => {
    expect(groundKpiRows([row({ quote: 'NPS не ниже 60' })], SOURCE)).toEqual([]);
  });

  it('число цели, вес и срок, которых нет в цитате, становятся пустыми', () => {
    const [kept] = groundKpiRows(
      [
        row({
          quote: 'Инциденты после релиза — не больше 2 в месяц',
          targetValue: 3,
          weight: 25,
          dueDate: '2027-03-31',
        }),
      ],
      SOURCE,
    );
    expect(kept).toMatchObject({ targetValue: null, weight: null, dueDate: null });
  });

  it('«кто поставил» берётся только если источник это называет', () => {
    const [kept] = groundKpiRows(
      [row({ setBy: 'team' })],
      SOURCE.replace('Поставил директор.', ''),
    );
    expect(kept?.setBy).toBeNull();
  });

  it('цитата сверяется без учёта регистра, «ё» и лишних пробелов; повторы и лишние строки отбрасываются', () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      row({ title: `Показатель ${index}`, quote: '2  ВАКАНСИИ закрыть до 28.02' }),
    );
    const kept = groundKpiRows([row({}), row({}), ...rows], SOURCE);
    expect(kept).toHaveLength(20);
    expect(new Set(kept.map((item) => item.title)).size).toBe(20);
  });
});

describe('parseKpiModelAnswer', () => {
  it('принимает ответ модели по схеме и отклоняет мусор', () => {
    const answer = JSON.stringify({ sourceText: 'x', rows: [row({})] });
    expect(parseKpiModelAnswer(answer)?.rows).toHaveLength(1);
    expect(parseKpiModelAnswer('не json')).toBeNull();
    expect(parseKpiModelAnswer(JSON.stringify({ rows: [{ title: 1 }] }))).toBeNull();
  });
});

describe('tableToText', () => {
  it('CSV и TSV: строки через « | », кавычки и запятые внутри ячейки', () => {
    const csv = 'Показатель,Цель,Вес\n"Срок релиза, дней",7,30 %\nЗакрыто вакансий,2,30 %\n';
    expect(tableToText(strToU8(csv), 'text/csv')).toBe(
      'Показатель | Цель | Вес\nСрок релиза, дней | 7 | 30 %\nЗакрыто вакансий | 2 | 30 %',
    );
    expect(tableToText(strToU8('a\tb\n1\t2'), 'text/tab-separated-values')).toBe('a | b\n1 | 2');
  });

  it('XLSX: первый лист с общими и встроенными строками', () => {
    const sheet =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Срок релиза</t></is></c><c r="B2"><v>7</v></c></row>' +
      '</sheetData></worksheet>';
    const shared = '<sst><si><t>Показатель</t></si><si><r><t>Ц</t></r><r><t>ель</t></r></si></sst>';
    const file = zipSync({
      'xl/worksheets/sheet1.xml': strToU8(sheet),
      'xl/sharedStrings.xml': strToU8(shared),
    });
    expect(
      tableToText(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('Показатель | Цель\nСрок релиза | 7');
  });

  it('XLSX с распакованным листом больше 8 МБ не читается (zip-бомба)', () => {
    const huge = new Uint8Array(9 * 1024 * 1024);
    const file = zipSync({ 'xl/worksheets/sheet1.xml': huge }, { level: 9 });
    expect(file.length).toBeLessThan(64 * 1024);
    expect(
      tableToText(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('');
  });

  it('лист из незакрытых ячеек читается за линейное время', () => {
    const sheet =
      '<worksheet><sheetData><row>' + '<c>'.repeat(200_000) + '</row></sheetData></worksheet>';
    const file = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) });
    const started = performance.now();
    tableToText(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('битый файл — пустой текст, без исключения', () => {
    expect(
      tableToText(
        strToU8('not a zip'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('');
  });
});

describe('kpiWeightSum', () => {
  it('сумма весов или null, если весов нет', () => {
    expect(kpiWeightSum([{ weight: 30 }, { weight: 30 }, { weight: null }, { weight: 40 }])).toBe(
      100,
    );
    expect(kpiWeightSum([{ weight: null }])).toBeNull();
  });
});
