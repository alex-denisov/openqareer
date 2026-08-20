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
