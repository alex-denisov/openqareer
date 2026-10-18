// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTargetedResumeSlice } from '../../../server/domain/resumeStudio';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { estimateResumePages } from '../../../server/domain/resumeTargetedVolume';
import { ResumeAtsView } from './ResumeAtsView';
import { previewProjection, selectDocument } from './resumeStudioModel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = [];

function renderTargetedResume() {
  const title = 'Platform Engineer';
  const requirements = ['React', 'SQL'];
  const document = selectDocument(previewProjection(EMPTY_RESUME_DRAFT, []), 'master');
  const initialTarget = {
    title,
    requirements,
    slice: estimateResumePages(buildTargetedResumeSlice(document, { title, requirements })),
  };
  const onTargetDirtyChange = vi.fn();
  const container = documentFromView();
  const root = createRoot(container);
  act(() =>
    root.render(
      <ResumeAtsView
        document={document}
        draft={EMPTY_RESUME_DRAFT}
        initialTarget={initialTarget}
        onSaveTarget={() => undefined}
        onTargetDirtyChange={onTargetDirtyChange}
      />,
    ),
  );
  roots.push({ root, container });
  return { container, onTargetDirtyChange, title, requirements };
}

function documentFromView(): HTMLDivElement {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  return container;
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    field instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ResumeAtsView target snapshot dirty state', () => {
  afterEach(() => {
    for (const { root, container } of roots.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('marks changed title and requirements dirty, then clears the signal when values return to the saved snapshot', () => {
    const { container, onTargetDirtyChange, title, requirements } = renderTargetedResume();
    const titleInput = container.querySelector('input') as HTMLInputElement;
    const requirementsInput = container.querySelector('textarea') as HTMLTextAreaElement;

    expect(onTargetDirtyChange).toHaveBeenLastCalledWith(false);

    act(() => setFieldValue(titleInput, 'Platform Engineer II'));
    expect(onTargetDirtyChange).toHaveBeenLastCalledWith(true);

    act(() => setFieldValue(titleInput, title));
    expect(onTargetDirtyChange).toHaveBeenLastCalledWith(false);

    act(() => setFieldValue(requirementsInput, [...requirements, 'Redis'].join('\n')));
    expect(onTargetDirtyChange).toHaveBeenLastCalledWith(true);

    act(() => setFieldValue(requirementsInput, requirements.join('\n')));
    expect(onTargetDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
