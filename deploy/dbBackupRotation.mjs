// B777: какие копии базы в S3 оставить.
//  users — незаменимые данные каждую ночь: 14 последних дней и 6 последних первых чисел месяца;
//  full  — полная база по воскресеньям: 2 последние.
// Архив и манифест удаляются вместе; ключи не по схеме не трогаются.
// CLI: ключи бакета построчно на stdin → ключи к удалению построчно на stdout.

const KEY =
  /^db\/(users|full)\/\d{4}\/\d{2}\/openqareer-\1-(\d{8})-(\d{4})\.(?:db\.zst\.age|json)$/u;
const POLICY = {
  users: { daily: 14, monthly: 6 },
  full: { daily: 2, monthly: 0 },
};

/** Ключ копии: db/<уровень>/YYYY/MM/openqareer-<уровень>-YYYYMMDD-HHMM.<расширение>. */
export function backupKey(tier, stamp, ext = 'db.zst.age') {
  return `db/${tier}/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/openqareer-${tier}-${stamp}.${ext}`;
}

/** Последняя копия каждого дня, свежие дни первыми: [[YYYYMMDD, отметка], …]. */
function latestPerDay(stamps) {
  const byDay = new Map();
  for (const stamp of [...stamps].sort().reverse()) {
    const date = stamp.slice(0, 8);
    if (!byDay.has(date)) byDay.set(date, stamp);
  }
  return [...byDay.entries()];
}

function keptStamps(stamps, { daily, monthly }) {
  const days = latestPerDay(stamps);
  return new Set([
    ...days.slice(0, daily).map(([, stamp]) => stamp),
    ...days
      .filter(([date]) => date.endsWith('01'))
      .slice(0, monthly)
      .map(([, stamp]) => stamp),
  ]);
}

export function planRotation(keys) {
  const parsed = keys.flatMap((key) => {
    const match = key.match(KEY);
    return match ? [{ key, tier: match[1], stamp: `${match[2]}-${match[3]}` }] : [];
  });
  const kept = new Set();
  for (const tier of Object.keys(POLICY)) {
    const stamps = parsed.filter((item) => item.tier === tier).map((item) => item.stamp);
    for (const stamp of keptStamps(new Set(stamps), POLICY[tier])) kept.add(`${tier}:${stamp}`);
  }
  const sorted = [...parsed].sort((a, b) => (a.key < b.key ? 1 : -1));
  return {
    keep: sorted.filter((item) => kept.has(`${item.tier}:${item.stamp}`)).map((item) => item.key),
    remove: sorted
      .filter((item) => !kept.has(`${item.tier}:${item.stamp}`))
      .map((item) => item.key),
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
