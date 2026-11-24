import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type ChunkModule<P> = { readonly default: ComponentType<P> };

export interface RetryableChunk<P> {
  /** Компонент куска: один и тот же, пока загрузка не сорвалась. */
  readonly component: () => LazyExoticComponent<ComponentType<P>>;
  /** Загрузить кусок заново: после сбоя — настоящий новый `import()`. */
  readonly load: () => Promise<ChunkModule<P>>;
  /** Забыть сорвавшийся `lazy`: он запоминает отказ навсегда. */
  readonly forgetFailure: () => void;
}

/** Vite второй раз стили куска не просит: без перезагрузки раздел открылся бы без оформления. */
const isStylesFailure = (error: unknown) =>
  error instanceof Error && error.message.startsWith('Unable to preload CSS');

export function retryableChunk<P>(request: () => Promise<ChunkModule<P>>): RetryableChunk<P> {
  let failed = false;
  let stylesFailure: unknown = null;
  let current: LazyExoticComponent<ComponentType<P>> | null = null;
  const load = async () => {
    if (stylesFailure) throw stylesFailure;
    try {
      return await request();
    } catch (error) {
      failed = true;
      if (isStylesFailure(error)) stylesFailure = error;
      throw error;
    }
  };
  return {
    component: () => (current ??= lazy(load)),
    load,
    forgetFailure: () => {
      if (!failed) return;
      failed = false;
      current = null;
    },
  };
}

/**
 * «Попробовать снова»: кусок запрашивается заново. Отказ бывает запомнен браузером, а после
 * выката прежнего куска уже нет: если сервер отвечает, страница перезагружается — один раз
 * на нажатие. Связи нет — остаёмся на месте.
 */
export async function retryChunk(
  chunk: { readonly load: () => Promise<unknown> },
  reload: () => void,
): Promise<boolean> {
  try {
    await chunk.load();
    return true;
  } catch {
    const reachable = await fetch('/health', { cache: 'no-store' }).then(
      (response) => response.ok,
      () => false,
    );
    if (reachable) reload();
    return false;
  }
}
