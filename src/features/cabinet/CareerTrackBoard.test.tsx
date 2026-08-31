import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerTrackBoard } from './CareerTrackBoard';
import type { CandidateSnapshot, CoachResult } from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';

/**
 * Production walkthrough of B160 caught the race: the cabinet reads the
 * account after it mounts, so «Изменить роль и условия» could be opened while
 * the current role and work mode were still unknown. Saving that form would
 * have written the empty form back over answers it never showed.
 */
function render(premisesLoading: boolean) {
  return renderToStaticMarkup(
    <CareerTrackBoard
      targetDirection="Senior Software Engineer"
      regions={['ru']}
      premises={{ targetRole: '', regions: [], workMode: null }}
      premisesLoading={premisesLoading}
      onNavigate={() => undefined}
      onSavePremises={async () => undefined}
    />,
  );
}

describe('route premises editing while the cabinet is still reading', () => {
  it('does not offer an editor over premises it has not read yet', () => {
    const html = render(true);

    expect(html).toContain('disabled');
    expect(html).toContain('Читаем текущие ответы');
  });

  it('offers the editor once the premises are known', () => {
    const html = render(false);

    expect(html).not.toContain('disabled');
    expect(html).not.toContain('Читаем текущие ответы');
    expect(html).toContain('Изменить роль и условия');
  });
});

/**
 * B178 срез 2. «Рабочие роли» показывали вывод локального словаря, пока
 * стратег в панели на том же профиле называл другие роли: два независимых
 * «мозга» противоречили друг другу на одном экране. Роли называет
 * `career_strategist`; нет его вывода — нет ролей.
 */
function renderWithTrack(track: CoachResult['careerTrack']) {
  const snapshot = {
    candidate: {
      id: 'candidate-1',
      dataClass: 'synthetic',
      locale: 'ru-RU',
      createdAt: '2026-08-31T00:00:00.000Z',
    },
    messages: [],
    memory: [],
    turns: [
      {
        idempotencyKey: 'turn-1',
        phase: 'market',
        status: 'completed',
        result: { careerTrack: track } as CoachResult,
        provenance: null,
      },
    ],
  } as unknown as CandidateSnapshot;

  return renderToStaticMarkup(
    <CareerTrackBoard
      targetDirection="Продуктовый аналитик"
      regions={['ru']}
      snapshot={snapshot}
      journey={
        {
          roles: [
            {
              id: 'role-analytics-1',
              title: 'Analytics Lead',
              fitState: 'adjacent',
              basis: 'Смежная гипотеза из той же группы задач.',
              evidenceCount: 3,
              gaps: ['Сравнить повторяющиеся задачи в 5–10 вакансиях.'],
            },
          ],
          track: [],
        } as unknown as CareerJourney
      }
      premises={{ targetRole: '', regions: [], workMode: null }}
      premisesLoading={false}
      onNavigate={() => undefined}
      onSavePremises={async () => undefined}
    />,
  );
}

describe('роли в кабинете приходят от стратега', () => {
  it('показывает названные стратегом роли с его обоснованием', () => {
    const html = renderWithTrack({
      objective: 'Проверить два направления на рынке до конца квартала',
      alternatives: [
        {
          label: 'Аналитик данных',
          reason: 'Три подтверждённых эпизода со сквозной аналитикой и SQL.',
          evidenceRefs: ['memory:1'],
          unknowns: ['Нет подтверждённого управленческого эпизода.'],
        },
      ],
      milestones: [],
    });

    expect(html).toContain('Аналитик данных');
    expect(html).toContain('Три подтверждённых эпизода со сквозной аналитикой и SQL.');
    expect(html).not.toContain('Analytics Lead');
  });

  it('без вывода стратега не называет роль сама', () => {
    const html = renderWithTrack(null);

    expect(html).not.toContain('Analytics Lead');
    expect(html).toContain('стратег');
  });
});
