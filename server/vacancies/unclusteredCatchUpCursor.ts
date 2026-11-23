import type { DatabaseSync } from 'node:sqlite';

/**
 * B763: курсор прохода догона по `rowid` индекса пула. В памяти он обнулялся на каждом
 * рестарте обслуживания, а проход 2,2 млн строк дольше промежутка между выкатами — старые
 * строки без кластера не достигались никогда. Служебное состояние, не данные кандидата.
 */
export interface UnclusteredCatchUpCursor {
  read(): number;
  /** Одна запись за такт, своим автокоммитом, вне длинной транзакции. */
  write(rowid: number): void;
}

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS unclustered_catch_up_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_rowid INTEGER NOT NULL
)`;

export function createUnclusteredCatchUpCursor(database: DatabaseSync): UnclusteredCatchUpCursor {
  database.exec(TABLE_SQL);
  const select = database.prepare(
    'SELECT cursor_rowid FROM unclustered_catch_up_state WHERE id = 1',
  );
  const upsert = database.prepare(
    `INSERT INTO unclustered_catch_up_state (id, cursor_rowid) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET cursor_rowid = excluded.cursor_rowid`,
  );
  return {
    read: () => {
      const row = select.get() as { cursor_rowid?: number } | undefined;
      return typeof row?.cursor_rowid === 'number' ? row.cursor_rowid : 0;
    },
    write: (rowid) => {
      upsert.run(Math.max(0, Math.trunc(rowid)));
    },
  };
}
