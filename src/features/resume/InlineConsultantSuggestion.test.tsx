import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  InlineConsultantSuggestion,
  type InlineSuggestionItem,
} from './InlineConsultantSuggestion';
import { ProfileAboutSection } from './ProfileAboutSection';
import { ProfileExperienceSection } from './ProfileExperienceSection';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';

const sampleAboutSuggestion: InlineSuggestionItem = {
  id: 'sug-1',
  section: 'about',
  title: 'Предложение карьерного консультанта',
  rationale: 'Усилить позиционирование и ключевые компетенции',
  currentText: 'Занимаюсь фронтендом 3 года.',
  proposedText: 'Senior Frontend Engineer с 3 годами опыта в высоконагруженных системах.',
};

const sampleExpSuggestion: InlineSuggestionItem = {
  id: 'sug-2',
  section: 'experience',
  experienceId: 'exp-1',
  title: 'Предложение карьерного консультанта',
  rationale: 'Уточнить грейд в заголовке роли',
  currentText: 'Frontend Developer',
  proposedText: 'Lead Frontend Developer',
};

describe('InlineConsultantSuggestion', () => {
  it('рендерит предложение консультанта со сравнением «сейчас → станет»', () => {
    const html = renderToStaticMarkup(
      <InlineConsultantSuggestion
        suggestion={sampleAboutSuggestion}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain('career-consultant-suggestion');
    expect(html).toContain('Предложение карьерного консультанта');
    expect(html).toContain('Усилить позиционирование и ключевые компетенции');
    expect(html).toContain('Сейчас');
    expect(html).toContain('Занимаюсь фронтендом 3 года.');
    expect(html).toContain('Станет');
    expect(html).toContain(
      'Senior Frontend Engineer с 3 годами опыта в высоконагруженных системах.',
    );
    expect(html).toContain('Принять');
    expect(html).toContain('Отклонить');
  });

  it('рендерит состояние «Правка применена» и кнопку «Откатить» если applied: true', () => {
    const html = renderToStaticMarkup(
      <InlineConsultantSuggestion
        suggestion={{ ...sampleAboutSuggestion, applied: true }}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
        onRevert={vi.fn()}
      />,
    );

    expect(html).toContain('Правка применена');
    expect(html).toContain('Откатить');
    expect(html).not.toContain('Принять');
  });

  it('отображается в ProfileAboutSection', () => {
    const html = renderToStaticMarkup(
      <ProfileAboutSection
        draft={{
          ...EMPTY_RESUME_DRAFT,
          candidate: { ...EMPTY_RESUME_DRAFT.candidate, about: 'Занимаюсь фронтендом 3 года.' },
        }}
        onSectionSave={vi.fn()}
        suggestions={[sampleAboutSuggestion]}
      />,
    );

    expect(html).toContain('career-consultant-suggestion');
    expect(html).toContain('Предложение карьерного консультанта');
    expect(html).toContain('Senior Frontend Engineer с 3 годами опыта в высоконагруженных системах.');
  });

  it('отображается в ProfileExperienceSection для предложений по опыту', () => {
    const html = renderToStaticMarkup(
      <ProfileExperienceSection
        draft={{
          ...EMPTY_RESUME_DRAFT,
          experience: [
            {
              id: 'exp-1',
              chronologyMemoryId: 'chron-1',
              title: 'Frontend Developer',
              employer: 'Acme Corp',
              current: true,
              bulletMemoryIds: [],
            },
          ],
        }}
        onSectionSave={vi.fn()}
        suggestions={[sampleExpSuggestion]}
      />,
    );

    expect(html).toContain('career-consultant-suggestion');
    expect(html).toContain('Lead Frontend Developer');
    expect(html).toContain('Принять');
    expect(html).toContain('Отклонить');
  });
});
