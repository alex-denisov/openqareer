import { useCallback, useEffect, useState } from 'react';
import type { ProfileScreenSurfaceProps } from './ProfileScreenView';
import type { ProfileDataSection } from './ProfileDataDialog';

const DIALOG_TARGETS: readonly string[] = [
  'name',
  'contacts',
  'courses',
  'certifications',
  'recommendations',
  'achievements',
];

export function useProfileDataDialog(props: ProfileScreenSurfaceProps, desktop: boolean) {
  const [state, setState] = useState<{
    readonly open: boolean;
    readonly section?: ProfileDataSection;
  }>({ open: false });
  const open = useCallback((section?: ProfileDataSection) => setState({ open: true, section }), []);
  const close = useCallback(() => setState({ open: false }), []);
  const request = props.profileFocusRequest;
  const managedRequest = Boolean(request && DIALOG_TARGETS.includes(request.section));
  useEffect(() => {
    if (!desktop || !request) return;
    if (DIALOG_TARGETS.includes(request.section)) open(request.section as ProfileDataSection);
    else close();
  }, [desktop, request, open, close]);
  return { ...state, select: open, close, managedRequest };
}
