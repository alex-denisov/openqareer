import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { sha256 } from './block-a-review-assets.mjs';

function resolveColorToken(tokens, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('{')) return reference;
  const tokenPath = reference.slice(1, -1).split('.');
  let token = tokens;
  for (const part of tokenPath) {
    token = token?.[part];
    if (!token) throw new Error(`Unknown KIT color token: ${reference}`);
  }
  if (typeof token.$value !== 'string') {
    throw new Error(`KIT color token has no string value: ${reference}`);
  }
  return resolveColorToken(tokens, token.$value);
}

export async function readDesignTokenColors() {
  const tokenPath = path.join(
    homedir(),
    '.claude',
    'plugins',
    'marketplaces',
    'ux-ui-agent-skills',
    'tokens',
    'colors.json',
  );
  const tokenData = JSON.parse(await readFile(tokenPath, 'utf8'));
  return {
    lightText: resolveColorToken(tokenData, tokenData.semantic.text.primary.$value),
    darkText: resolveColorToken(tokenData, tokenData.dark.text.primary.$value),
    lightLink: resolveColorToken(tokenData, tokenData.semantic.text.link.$value),
    darkLink: resolveColorToken(tokenData, tokenData.dark.text.link.$value),
    lightSurface: resolveColorToken(tokenData, tokenData.semantic.surface.page.$value),
    darkSurface: resolveColorToken(tokenData, tokenData.dark.surface.page.$value),
    source: {
      path: tokenPath,
      sha256: await sha256(tokenPath),
      lightTokens: ['semantic.text.primary', 'semantic.text.link', 'semantic.surface.page'],
      darkTokens: ['dark.text.primary', 'dark.text.link', 'dark.surface.page'],
    },
  };
}
