/**
 * B159 — установленное десктопное приложение должно уметь сказать, какая это
 * сборка. Метку берём из git, но только когда дерево чистое: собранное из
 * изменённого дерева приложение с чужим SHA утверждало бы, что в нём код того
 * коммита, — а это неправда. Грязное дерево остаётся честно непомеченным.
 *
 * @param {string} headSha полный SHA HEAD
 * @param {string} porcelain вывод `git status --porcelain`
 * @returns {{ sha: string, reason: 'head' | 'dirty-tree' | 'no-head' }}
 */
export function desktopBuildSha(headSha, porcelain) {
  const sha = headSha.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) return { sha: '', reason: 'no-head' };
  if (porcelain.trim().length > 0) return { sha: '', reason: 'dirty-tree' };
  return { sha, reason: 'head' };
}
