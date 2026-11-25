import type { ComponentType } from 'react';
import { matchNode, type B640Node, type B640Section } from './routes';
import { retryableChunk, type RetryableChunk } from './shell/chunk';

/** Что получает вход раздела: узел карты и параметры его адреса. */
export interface SectionProps {
  readonly node: B640Node;
  readonly params: Readonly<Record<string, string>>;
}

type SectionEntry = RetryableChunk<SectionProps>;

/** Модуль входа раздела: экран по умолчанию и, если есть, раннее чтение данных узла. */
interface SectionModule {
  readonly default: ComponentType<SectionProps>;
  readonly preload?: (code: string, search: string) => void;
}

const SECTION_LOADERS: Readonly<Record<B640Section, () => Promise<SectionModule>>> = {
  today: () => import('./today/index'),
  profile: () => import('./profile/index'),
  footprint: () => import('./footprint/index'),
  career: () => import('./career/index'),
  vacancies: () => import('./vacancies/index'),
  companies: () => import('./companies/index'),
  platforms: () => import('./platforms/index'),
  responses: () => import('./responses/index'),
  apply: () => import('./apply/index'),
  offers: () => import('./offers/index'),
  interview: () => import('./interview/index'),
  consultant: () => import('./consultant/index'),
  account: () => import('./account/index'),
  diary: () => import('./diary/index'),
  adaptation: () => import('./adaptation/index'),
};

/** Каждый раздел — свой кусок сборки: код раздела грузится при первом заходе. */
export const SECTION_ENTRIES = Object.fromEntries(
  Object.entries(SECTION_LOADERS).map(([section, load]) => [section, retryableChunk<SectionProps>(load)]),
) as Readonly<Record<B640Section, SectionEntry>>;

/**
 * B773: код раздела и данные экрана — вместе с вопросом о сессии, а не после него и
 * отрисовки оболочки. Сбой здесь не мешает: экран прочитает сам, как прежде.
 */
export function preloadSection(pathname: string, search = ''): Promise<void> {
  const match = matchNode(pathname);
  if (!match) return Promise.resolve();
  return SECTION_LOADERS[match.node.section]()
    .then((module) => module.preload?.(match.node.code, search))
    .catch(() => undefined);
}

/** B792: наведение или касание ссылки — код раздела заранее; данные читает сам экран. */
export function preloadSectionCode(pathname: string): void {
  const match = matchNode(pathname);
  if (match) void SECTION_LOADERS[match.node.section]().catch(() => undefined);
}
