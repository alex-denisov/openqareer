export function resolvedDesktopSessionPath(
  currentPath: string,
  hasCandidateSession: boolean,
): string | undefined {
  if (hasCandidateSession && (currentPath === '/login' || currentPath === '/')) {
    return '/app';
  }
  if (!hasCandidateSession && currentPath === '/app') {
    return '/login';
  }
  return undefined;
}

/**
 * A desktop token may survive a temporary transport failure. Only an
 * authenticated response that explicitly says the session is invalid should
 * send the user back to login; treating every error as expiry caused a brief
 * API outage to log out an otherwise valid desktop session.
 */
export function desktopSessionFailureRequiresSignOut(
  isDesktop: boolean,
  errorCode: string | undefined,
): boolean {
  return (
    isDesktop &&
    typeof errorCode === 'string' &&
    /^(?:http_401|http_403|unauthorized|invalid_session|session_expired)$/i.test(errorCode)
  );
}
