import { isBuildMarked } from './buildFreshness';

export function appVersionLine(version: string, commitSha: string): string {
  const trimmedSha = commitSha.trim();
  if (!isBuildMarked(trimmedSha)) return `openqareer ${version}`;
  const shortSha = trimmedSha.length >= 7 ? trimmedSha.slice(0, 7) : '';
  return `openqareer ${version} · сборка ${shortSha}`;
}
