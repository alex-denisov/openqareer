import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { B640Node, B640Section } from './routes';

/** Что получает вход раздела: узел карты и параметры его адреса. */
export interface SectionProps {
  readonly node: B640Node;
  readonly params: Readonly<Record<string, string>>;
}

type SectionEntry = LazyExoticComponent<ComponentType<SectionProps>>;

/** Каждый раздел — свой кусок сборки: код раздела грузится при первом заходе. */
export const SECTION_ENTRIES: Readonly<Record<B640Section, SectionEntry>> = {
  today: lazy(() => import('./today/index')),
  profile: lazy(() => import('./profile/index')),
  footprint: lazy(() => import('./footprint/index')),
  career: lazy(() => import('./career/index')),
  vacancies: lazy(() => import('./vacancies/index')),
  companies: lazy(() => import('./companies/index')),
  platforms: lazy(() => import('./platforms/index')),
  responses: lazy(() => import('./responses/index')),
  apply: lazy(() => import('./apply/index')),
  offers: lazy(() => import('./offers/index')),
  interview: lazy(() => import('./interview/index')),
  consultant: lazy(() => import('./consultant/index')),
  account: lazy(() => import('./account/index')),
  diary: lazy(() => import('./diary/index')),
  adaptation: lazy(() => import('./adaptation/index')),
};
