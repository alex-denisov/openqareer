/** B569 SEO-03/04: per-page share image and self-hosted Onest hints for public documents. */
const SITE_ORIGIN = 'https://openqareer.com';

export type OgImageName =
  | 'home'
  | 'faq'
  | 'tariffs'
  | 'salary-calculator'
  | 'resume'
  | 'interview-questions'
  | 'relocation'
  | 'salaries'
  | 'vacancies';

export function ogImageUrl(name: OgImageName): string {
  return `${SITE_ORIGIN}/og/${name}.png`;
}

/** Points og:image and twitter:image at the page's own 1200x630 picture. */
export function withOgImage(html: string, name: OgImageName, alt?: string): string {
  const url = ogImageUrl(name);
  const withImages = html
    .replace(/(<meta property="og:image" content=")[^"]*/u, `$1${url}`)
    .replace(/(<meta name="twitter:image" content=")[^"]*/u, `$1${url}`);
  const title = /<meta property="og:title" content="([^"]*)"/u.exec(html)?.[1] ?? '';
  return withImages.replace(/(<meta property="og:image:alt" content=")[^"]*/u, `$1${alt ?? title}`);
}

const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

/** Hashed woff2 paths found in the build output, keyed `cyrillic-400`. */
export type OnestFiles = Readonly<Record<string, string>>;

export function onestPreloadLinks(files: OnestFiles): string {
  return ['cyrillic-400', 'cyrillic-600']
    .map((key) => files[key])
    .filter((path): path is string => Boolean(path))
    .map((path) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${path}">`)
    .join('');
}

export function withOnestPreload(html: string, files: OnestFiles): string {
  const links = onestPreloadLinks(files);
  if (!links || html.includes('as="font"')) return html;
  return html.replace('</title>', () => `</title>${links}`);
}

/** Same faces the bundle ships, for server pages that carry no bundle CSS. */
export function onestFontFaceCss(files: OnestFiles): string {
  return ['cyrillic-400', 'cyrillic-600', 'latin-400', 'latin-600']
    .filter((key) => files[key])
    .map((key) => {
      const [subset, weight] = key.split('-');
      return `@font-face{font-family:Onest;font-style:normal;font-display:swap;font-weight:${weight};src:url(${files[key]}) format("woff2");unicode-range:${subset === 'cyrillic' ? CYRILLIC : LATIN}}`;
    })
    .join('');
}
