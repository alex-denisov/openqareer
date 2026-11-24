import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { candidateFlagLookup } from '../candidate/hhRaiseQueue';
import { flaggedCandidates } from './weeklySelectionSchedule';

describe('B649: недельная подборка соблюдает флаг кабинета', () => {
  it('кандидата без флага не берёт', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(
      `CREATE TABLE users (username TEXT, role TEXT, candidate_id TEXT);
       INSERT INTO users VALUES ('alice', 'candidate', 'a'), ('bob', 'candidate', 'b');`,
    );
    const lookup = candidateFlagLookup(database, { cabinetB640Usernames: ['alice'] });
    expect(flaggedCandidates(['a', 'b', 'gone'], lookup)).toEqual(['a']);
    database.close();
  });
});
