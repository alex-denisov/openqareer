// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RESPONSES_TAB_TOPICS } from '../applications/responsesTabTopics';
import type { ResponsesWorkspaceSection } from '../applications/ResponsesWorkspaceControls';
import type { CoachTurnStage } from '../coach/coachApi';
import { ConsultantSuggestionProvider } from './consultantScreenSuggestion';
import {
  useConsultantScreenTopic,
  usePublishConsultantTopic,
  type ConsultantScreenTopic,
} from './consultantScreenTopic';
import { STARTER_PROMPTS_BY_STAGE } from './starterPrompts';

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  document.body.innerHTML = '';
});

function Tab({ section }: { readonly section: ResponsesWorkspaceSection | null }) {
  usePublishConsultantTopic(section ? RESPONSES_TAB_TOPICS[section] : null);
  return null;
}

let latest: ConsultantScreenTopic | null = null;
function Panel({ stage }: { readonly stage: CoachTurnStage }) {
  latest = useConsultantScreenTopic(stage);
  return null;
}

async function show(
  section: ResponsesWorkspaceSection | null,
  stage: CoachTurnStage = 'responses',
) {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      <ConsultantSuggestionProvider>
        <Tab section={section} />
        <Panel stage={stage} />
      </ConsultantSuggestionProvider>,
    );
  });
  return root;
}

describe('consultant topic per «Отклики» tab (B511 G3b item 3)', () => {
  it('gives «Хочу», «Подготовка» and «Офферы» their own intro and questions', () => {
    const topics = (['company-wants', 'preparation', 'offers'] as const).map(
      (section) => RESPONSES_TAB_TOPICS[section],
    );
    const intros = new Set(topics.map((topic) => topic?.intro));
    expect(intros.size).toBe(3);
    for (const topic of topics) {
      expect(topic?.intro).not.toContain('напомнить о себе');
      expect(topic?.prompts).toHaveLength(3);
      expect(topic?.prompts).not.toEqual(STARTER_PROMPTS_BY_STAGE.responses);
    }
  });

  it('keeps «Воронка» on the stage defaults', async () => {
    expect(RESPONSES_TAB_TOPICS.funnel).toBeNull();
    await show('funnel');
    expect(latest).toBeNull();
  });

  it('shows the published tab topic to the responses panel only', async () => {
    await show('company-wants');
    expect(latest?.prompts).toEqual(RESPONSES_TAB_TOPICS['company-wants']?.prompts);
    await act(async () => roots[0].unmount());
    roots.splice(0);
    await show('offers', 'vacancies');
    expect(latest).toBeNull();
  });

  it('drops the topic when the tab unmounts', async () => {
    const root = await show('preparation');
    expect(latest?.id).toBe('responses-preparation');
    await act(async () => {
      root.render(
        <ConsultantSuggestionProvider>
          <Tab section={null} />
          <Panel stage="responses" />
        </ConsultantSuggestionProvider>,
      );
    });
    expect(latest).toBeNull();
  });
});
