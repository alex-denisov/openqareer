import { describe, expect, it } from 'vitest';
import { warmAssessmentContext, summarizeAssessmentContext } from './roleSkillAssessmentRoutes';
import { createRoleRequirementReader } from './roleSkillRequirementSource';
import { readRoleSnapshot } from './roleSnapshotRead';
import {
  createRig,
  CURRENT_PATH,
  headersFor,
  responseData,
  ROLE_TITLE,
} from './roleSkillAssessmentRouteTestRig';

const COUNT = 1_000;
const SKILLS = ['TypeScript', 'Kubernetes', 'Python', 'PostgreSQL', 'Docker', 'Agile'];
const DESCRIPTION = `Требования:\n${SKILLS.flatMap((skill) => [
  `- Опыт ${skill} от 3 лет`,
  `- Уверенное знание ${skill} и ответственность за результат`,
]).join('\n')}`;

function requirementDeps(onRead: () => void) {
  return {
    engine: {
      getVacancy: (id: string) => ({
        id,
        title: ROLE_TITLE,
        description: DESCRIPTION,
        isRemote: false,
      }),
    },
    extraDeps: {
      vacancyMechanics: {
        requirements: {
          getLatestOrLegacy: () => {
            onRead();
            return null;
          },
          enqueue: () => ({ state: 'queued' }),
        },
      },
    } as never,
  };
}

describe('B770: сводка роли не держит цикл событий одним куском', () => {
  it('требования вакансий читаются кусками, сводка та же, что одним куском', async () => {
    let turn = 0;
    let done = false;
    const seen = new Set<number>();
    const beat = () => {
      turn += 1;
      if (!done) setImmediate(beat);
    };
    const rig = await createRig(COUNT, false, {
      withClusterSkills: false,
      ...requirementDeps(() => seen.add(turn)),
    });
    const snapshot = await readRoleSnapshot(rig.deps, rig.candidate.id, ROLE_TITLE);
    if (snapshot.state !== 'matched') throw new Error('snapshot expected');
    const expected = summarizeAssessmentContext(
      ROLE_TITLE,
      2, // the version of the rig's strategy
      snapshot.vacancies,
      createRoleRequirementReader(rig.deps),
    );
    expect(expected).toMatchObject({ state: 'ready', sampleSize: COUNT });

    seen.clear();
    setImmediate(beat);
    await warmAssessmentContext(rig.deps, rig.candidate.id, ROLE_TITLE);
    done = true;

    // One piece reads every vacancy within a single turn of the loop.
    expect(seen.size).toBeGreaterThan(2);
    const response = await rig.app.inject({
      method: 'GET',
      url: `${CURRENT_PATH}?role=${encodeURIComponent(ROLE_TITLE)}`,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(response)).toMatchObject(JSON.parse(JSON.stringify(expected)));
  });
});
