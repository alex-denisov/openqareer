// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { ProfileItemSuggestions } from './ProfileItemSuggestions';
import { ProfileEducationSection } from './ProfileEducationSection';
import { REMOVE_ITEM_NOTE, type InlineSuggestionItem } from './InlineConsultantSuggestion';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const education: InlineSuggestionItem = {
  id: 'cmd-edu',
  commandId: 'cmd-edu',
  section: 'education',
  itemId: 'edu-1',
  operation: 'update',
  currentText: 'Бакалавр',
  proposedText: 'Магистр',
};
const removal: InlineSuggestionItem = {
  id: 'cmd-proj',
  commandId: 'cmd-proj',
  section: 'projects',
  itemId: 'proj-1',
  operation: 'remove',
  currentText: 'Платформа',
  proposedText: 'Платформа',
};
const addition: InlineSuggestionItem = {
  id: 'cmd-lang',
  commandId: 'cmd-lang',
  section: 'languages',
  operation: 'add',
  currentText: '',
  proposedText: 'Немецкий · A2',
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe('ProfileItemSuggestions (01.11)', () => {
  it('shows only the proposals of its own sections', () => {
    const view = render(
      <ProfileItemSuggestions sections={['education']} suggestions={[education, removal]} />,
    );
    expect(view.querySelectorAll('[data-testid^="consultant-suggestion-"]')).toHaveLength(1);
    expect(view.textContent).toContain('Магистр');
  });

  it('a removal says what goes away, an addition has no «Сейчас»', () => {
    const view = render(
      <ProfileItemSuggestions
        sections={['projects', 'languages']}
        suggestions={[removal, addition]}
      />,
    );
    const [remove, add] = [...view.querySelectorAll('.career-consultant-suggestion')];
    expect(remove?.textContent).toContain(REMOVE_ITEM_NOTE);
    expect(add?.textContent).not.toContain('Сейчас');
    expect(add?.textContent).toContain('Немецкий · A2');
  });

  it('«Принять» goes through the shared accept handler', async () => {
    const onAccept = vi.fn();
    const view = render(
      <ProfileItemSuggestions
        sections={['education']}
        suggestions={[education]}
        onAcceptSuggestion={onAccept}
      />,
    );
    const accept = [...view.querySelectorAll('button')].find((b) => b.textContent === 'Принять');
    await act(async () => accept?.click());
    expect(onAccept).toHaveBeenCalledWith(education);
  });

  it('renders inside the education section under its head', () => {
    const view = render(
      <ProfileEducationSection
        draft={EMPTY_RESUME_DRAFT}
        onSectionSave={() => true}
        consultant={<ProfileItemSuggestions sections={['education']} suggestions={[education]} />}
      />,
    );
    const section = view.querySelector('#sec-education');
    expect(section?.querySelector('.career-consultant-suggestion')).not.toBeNull();
  });
});
