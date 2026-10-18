import { useEffect, useRef } from 'react';
import type { ProfileMobileDataProps } from './profileMobileTypes';
import type {
  ProfileFocusRequest,
  ProfileMobileRoute,
  useProfileMobileNavigation,
} from './profileMobileNavigation';
import type { ProfileTab } from './profileTabs';

export function mobileRouteForProfileFocus(
  request: ProfileFocusRequest,
  props: Pick<ProfileMobileDataProps, 'draft'>,
): ProfileMobileRoute {
  switch (request.section) {
    case 'name':
    case 'contacts':
      return { page: 'contacts' };
    case 'education':
      return { page: 'edu', entryId: 'new-education' };
    case 'courses':
      return { page: 'edu', entryId: 'new-course' };
    case 'projects':
      return { page: 'proj', entryId: 'new' };
    case 'languages':
      return { page: 'lang', entryId: 'new' };
    case 'skills':
      return { page: 'home' };
    case 'review':
      return { page: 'check' };
    case 'experience': {
      if (!request.experienceId && !request.employer && !request.title && !request.field)
        return { page: 'exp' };
      const entry = props.draft.experience.find((item) =>
        request.experienceId
          ? item.id === request.experienceId
          : (!request.employer || item.employer === request.employer) &&
            (!request.title || item.title === request.title),
      );
      return entry
        ? { page: request.field === 'teamSize' ? 'job' : 'jobedit', entryId: entry.id }
        : { page: 'jobadd' };
    }
    default:
      return { page: request.section };
  }
}

export function useMobileProfileFocus(
  props: ProfileMobileDataProps,
  navigation: ReturnType<typeof useProfileMobileNavigation>,
  setTab: (tab: ProfileTab) => void,
) {
  const consumed = useRef<ProfileFocusRequest>();
  const request = props.profileFocusRequest;
  const { route, open } = navigation;
  useEffect(() => {
    if (!request || consumed.current === request) return;
    const target = mobileRouteForProfileFocus(request, props);
    if (route.page !== target.page || route.entryId !== target.entryId) {
      open(target);
      return;
    }
    consumed.current = request;
    if (request.section === 'skills') {
      setTab('skills');
      props.onTabChange?.('skills');
    }
    if (request.section === 'experience' && request.field === 'teamSize')
      props.onCollectExperienceFact?.(request);
    const field =
      request.section === 'experience'
        ? request.field
        : request.section === 'name'
          ? 'fullName'
          : undefined;
    if (field)
      document
        .querySelector<HTMLInputElement>(`.career-profile-mobile input[name="${field}"]`)
        ?.focus();
    props.onProfileFocusHandled?.();
  }, [request, props, route, open, setTab]);
}
