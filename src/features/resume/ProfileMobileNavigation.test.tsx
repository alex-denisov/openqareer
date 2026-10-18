// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProfileMobileNavigation } from './profileMobileNavigation';
import { mobileRouteForProfileFocus, useMobileProfileFocus } from './useMobileProfileFocus';
import type { ProfileMobileDataProps } from './profileMobileTypes';

const props: ProfileMobileDataProps = {
  candidateId: 'candidate-test',
  memory: [],
  onRetry: vi.fn(),
  onDraftChange: vi.fn(),
  onSectionSave: vi.fn(),
  draft: {
    candidate: { fullName: 'Тест' },
    education: [],
    languages: [],
    experience: [
      {
        id: 'first',
        employer: 'Компания',
        title: 'Инженер',
        chronologyMemoryId: 'memory-1',
        current: true,
        bulletMemoryIds: [],
      },
      {
        id: 'second',
        employer: 'Компания',
        title: 'Руководитель',
        chronologyMemoryId: 'memory-2',
        current: false,
        bulletMemoryIds: [],
      },
    ],
  },
};
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe('mobile profile routes', () => {
  it('opens the requested experience even when employers are the same', () => {
    expect(
      mobileRouteForProfileFocus(
        { section: 'experience', experienceId: 'second', field: 'endDate' },
        props,
      ),
    ).toEqual({ page: 'jobedit', entryId: 'second' });
    expect(
      mobileRouteForProfileFocus(
        { section: 'experience', employer: 'Компания', title: 'Руководитель', field: 'teamSize' },
        props,
      ),
    ).toEqual({ page: 'job', entryId: 'second' });
  });

  it('keeps courses and education as distinct add forms', () => {
    expect(mobileRouteForProfileFocus({ section: 'courses' }, props)).toEqual({
      page: 'edu',
      entryId: 'new-course',
    });
    expect(mobileRouteForProfileFocus({ section: 'education' }, props)).toEqual({
      page: 'edu',
      entryId: 'new-education',
    });
  });

  it('consumes a date request after its actual input mounts, then returns home', () => {
    const handled = vi.fn();
    const request = { section: 'experience', experienceId: 'second', field: 'endDate' } as const;
    let navigation: ReturnType<typeof useProfileMobileNavigation>;
    function Harness() {
      navigation = useProfileMobileNavigation();
      useMobileProfileFocus(
        { ...props, profileFocusRequest: request, onProfileFocusHandled: handled },
        navigation,
        vi.fn(),
      );
      return (
        <div className="career-profile-mobile">
          {navigation.route.page === 'jobedit' ? <input name="endDate" /> : null}
        </div>
      );
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    act(() => root.render(<Harness />));
    expect(navigation!.route).toEqual({ page: 'jobedit', entryId: 'second' });
    expect(handled).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(container.querySelector('input'));
    act(() => navigation.back());
    expect(navigation!.route.page).toBe('home');
    expect(handled).toHaveBeenCalledOnce();
  });
});
