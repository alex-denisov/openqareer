export function appVersionLine(version: string, commitSha: string): string {
  const trimmedSha = commitSha.trim();
  const shortSha = trimmedSha.length >= 7 ? trimmedSha.slice(0, 7) : '';
  if (!shortSha) {
    return `openqareer ${version} · сборка не помечена`;
  }
  return `openqareer ${version} · сборка ${shortSha}`;
}
