// B777: какие ночные копии базы в S3 оставить. 7 последних дней, 4 последних воскресенья,
// 6 последних первых чисел месяца; остальные удаляются вместе с манифестом.
// CLI: ключи бакета построчно на stdin → ключи к удалению построчно на stdout.

const KEY = /^db\/\d{4}\/\d{2}\/openqareer-(\d{8})-(\d{4})\.(?:db\.zst\.age|json)$/u;
const DAILY = 7;
const WEEKLY = 4;
const MONTHLY = 6;

function isSunday(date) {
  const day = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))),
  );
  return day.getUTCDay() === 0;
}

/** Последняя копия каждого дня, свежие дни первыми. */
function latestPerDay(stamps) {
  const byDay = new Map();
  for (const stamp of [...stamps].sort().reverse()) {
    const date = stamp.slice(0, 8);
    if (!byDay.has(date)) byDay.set(date, stamp);
  }
  return [...byDay.entries()];
}

export function planRotation(keys) {
  const ours = keys.filter((key) => KEY.test(key));
  const stampOf = (key) => {
    const [, date, time] = key.match(KEY);
    return `${date}-${time}`;
  };
  const days = latestPerDay(new Set(ours.map(stampOf)));
  const kept = new Set([
    ...days.slice(0, DAILY).map(([, stamp]) => stamp),
    ...days
      .filter(([date]) => isSunday(date))
      .slice(0, WEEKLY)
      .map(([, stamp]) => stamp),
    ...days
      .filter(([date]) => date.endsWith('01'))
      .slice(0, MONTHLY)
      .map(([, stamp]) => stamp),
  ]);
  const sorted = [...ours].sort().reverse();
  return {
    keep: sorted.filter((key) => kept.has(stampOf(key))),
    remove: sorted.filter((key) => !kept.has(stampOf(key))),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const keys = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const key of planRotation(keys).remove) process.stdout.write(`${key}\n`);
}
