import type { ProfileScreenSurfaceProps } from './ProfileScreenView';
import type { ResumeDraft } from './resumeTypes';
import type { ProfileMobileRoute } from './profileMobileNavigation';

export type ProfileMobileDataProps = ProfileScreenSurfaceProps & { readonly draft: ResumeDraft };
export interface ProfileMobileNavigationProps {
  readonly open: (route: ProfileMobileRoute) => void;
  readonly back: () => void;
}
