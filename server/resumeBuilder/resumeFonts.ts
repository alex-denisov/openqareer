import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * B567: fonts with Cyrillic for the PDF export. The release carries them in
 * `fonts/resume/` next to `server.mjs` (copied by build-server.mjs); in the
 * repository they are read straight from the package that ships them.
 */
export interface ResumeFontSet {
  readonly regular: Buffer;
  readonly bold: Buffer;
  readonly italic: Buffer;
}

export type ResumeFontFamily = 'serif' | 'sans';

export const RESUME_FONT_FILES: Record<ResumeFontFamily, Record<keyof ResumeFontSet, string>> = {
  serif: {
    regular: 'DejaVuSerif.ttf',
    bold: 'DejaVuSerif-Bold.ttf',
    italic: 'DejaVuSerif-Italic.ttf',
  },
  sans: {
    regular: 'DejaVuSans.ttf',
    bold: 'DejaVuSans-Bold.ttf',
    italic: 'DejaVuSans-Oblique.ttf',
  },
};

function candidateDirectories(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = process.cwd();
  return [
    join(here, 'fonts/resume'),
    join(root, 'dist/fonts/resume'),
    join(root, 'node_modules/dejavu-fonts-ttf/ttf'),
  ];
}

function readFont(file: string): Buffer {
  for (const directory of candidateDirectories()) {
    const path = join(directory, file);
    if (existsSync(path)) return readFileSync(path);
  }
  throw new Error(`resume_font_missing:${file}`);
}

const cache = new Map<ResumeFontFamily, ResumeFontSet>();

export function loadResumeFonts(family: ResumeFontFamily): ResumeFontSet {
  const cached = cache.get(family);
  if (cached) return cached;
  const files = RESUME_FONT_FILES[family];
  const set = {
    regular: readFont(files.regular),
    bold: readFont(files.bold),
    italic: readFont(files.italic),
  };
  cache.set(family, set);
  return set;
}
