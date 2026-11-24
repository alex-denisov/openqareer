// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import type { DebriefRecordingView } from '../../../../server/domain/interviewDebriefView';
import { mount, type Mounted } from '../kit/testDom';
import { ShellProvider } from '../shell/ShellContext';
import { DebriefSteps } from './DebriefSteps';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function done(recording: DebriefRecordingView | null, voiced = true) {
  view?.unmount();
  const shell = { path: '/app', search: '', navigate: () => undefined } as never;
  view = mount(
    <ShellProvider value={shell}>
      <DebriefSteps
        responseId="r1"
        current="debrief"
        debrief={{
          recording,
          voices: { status: 'ready', candidate: voiced ? 1 : null, items: [] },
        }}
      />
    </ShellProvider>,
  );
  return view.container.querySelectorAll('li.is-done').length;
}

it('B659: шаги отмечены, только когда пройдены', () => {
  const ready: DebriefRecordingView = {
    id: 'rec',
    status: 'ready',
    source: 'upload',
    startedAt: '2026-11-12T12:00:00Z',
    gaps: 0,
  };
  expect(done(null)).toBe(0);
  expect(done({ ...ready, status: 'failed' })).toBe(0);
  expect(done({ ...ready, status: 'transcribing' })).toBe(1);
  expect(done(ready, false)).toBe(1);
  expect(done(ready)).toBe(2);
});
