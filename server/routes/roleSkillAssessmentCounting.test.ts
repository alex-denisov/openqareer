import { describe, expect, it } from 'vitest';
import {
  CURRENT_PATH,
  createRig,
  headersFor,
  responseData,
} from './roleSkillAssessmentRouteTestRig';
import { CURRENT_SNAPSHOT_WAIT_MS } from './roleSkillAssessmentRoutes';

describe('B770: /current не ждёт 12 с снимок роли, которого ещё нет (прод 23.11 04:47Z)', () => {
  it('отвечает «считаем» через ~1,5 с, сборка идёт дальше, и повтор получает проверку', async () => {
    const rig = await createRig();
    const build = rig.getMatchedVacanciesAsync.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    rig.getMatchedVacanciesAsync.mockImplementation(async (query) => {
      await held;
      return build(query);
    });
    const started = performance.now();

    const first = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });

    const waited = performance.now() - started;
    expect(first.statusCode).toBe(200);
    expect(responseData(first)).toMatchObject({ state: 'counting' });
    expect(waited).toBeGreaterThanOrEqual(CURRENT_SNAPSHOT_WAIT_MS - 50);
    expect(waited).toBeLessThan(CURRENT_SNAPSHOT_WAIT_MS + 2_000);

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(second)).toMatchObject({ state: 'ready' });
    expect(rig.getMatchedVacanciesAsync).toHaveBeenCalledTimes(1);
  });
});
