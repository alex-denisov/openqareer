import { useEffect, useState } from 'react';
import {
  createVacancySubscription,
  deleteVacancySubscription,
  getVacancySources,
  getVacancySubscription,
  refreshVacancySubscription,
  updateVacancySubscription,
  type VacancySourceId,
  type VacancySourceRegistryEntry,
  type VacancySubscription,
  type VacancySubscriptionView,
} from '../coach/coachApi';
import { CoachApiError } from '../coach/apiClient';
import { intelligenceError } from '../cabinet/CareerIntelligencePanelParts';
import { seededQuery } from './savedSearchQuery';

/**
 * Состояние регулярных выборок отделено от разметки: панель фильтров рисует
 * три коротких блока, а вся работа с сетью живёт здесь (B181).
 */
// Одна машина состояний: чтение источников, выбор активной выборки и четыре
// её операции держатся вместе — разнесение спрятало бы порядок эффектов.
// eslint-disable-next-line max-lines-per-function
export function useSavedSearches({
  subscriptions,
  defaultQuery,
  onRefresh,
}: {
  readonly subscriptions: readonly VacancySubscription[];
  readonly defaultQuery?: string;
  readonly onRefresh: () => Promise<void>;
}) {
  const [activeId, setActiveId] = useState<string>();
  const [view, setView] = useState<VacancySubscriptionView>();
  const [query, setQueryState] = useState(defaultQuery ?? '');
  // Кандидат уже трогал поле: роль профиля больше не подставляется.
  const [touched, setTouched] = useState(false);
  const setQuery = (value: string) => {
    setTouched(true);
    setQueryState(value);
  };
  const [source, setSource] = useState<VacancySourceId>('hh');
  const [sources, setSources] = useState<VacancySourceRegistryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const seeded = seededQuery({ query, defaultQuery, touched });
    if (seeded !== query) setQueryState(seeded);
  }, [defaultQuery, query, touched]);

  useEffect(() => {
    let active = true;
    void getVacancySources()
      .then((result) => {
        if (!active) return;
        const list = Array.isArray(result) ? result : [];
        setSources(list);
        // Первой предлагается площадка, которая сейчас отвечает: заведомо
        // закрытая hh.ru по умолчанию встречала кандидата предупреждением
        // «нужен официальный доступ» (владелец, 2026-09-20).
        const healthy = list.find((item) => item.health.status === 'healthy');
        if (healthy) setSource((current) => (current === 'hh' ? healthy.id : current));
      })
      .catch((reason) => {
        if (active) setError(intelligenceError(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextId =
      activeId && subscriptions.some((item) => item.id === activeId)
        ? activeId
        : subscriptions[0]?.id;
    if (!nextId) {
      if (!activeId) setView(undefined);
      return;
    }
    if (nextId !== activeId) setActiveId(nextId);
    let active = true;
    void getVacancySubscription(nextId)
      .then((result) => {
        if (active) setView(result);
      })
      .catch((reason) => {
        if (!active) return;
        // Выборка из снимка кабинета, которой на сервере уже нет (удалена в
        // другом окне или снимок устарел): это не ошибка кандидата, а повод
        // перечитать список. «Поисковое направление не найдено» на первом
        // экране «Вакансий» — жалоба владельца 2026-09-20.
        if (reason instanceof CoachApiError && reason.code === 'vacancy_subscription_not_found') {
          setView(undefined);
          void onRefresh();
          return;
        }
        setError(intelligenceError(reason));
      });
    return () => {
      active = false;
    };
  }, [activeId, subscriptions]);

  async function guard(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  // Первая отрисовка обязана показать уже заведённую выборку, а не форму
  // «Настройте направление»: выбор по эффекту приходит только вторым кадром, и
  // кандидат успевал увидеть предложение завести то, что у него уже есть.
  const active =
    view?.subscription ??
    subscriptions.find((item) => item.id === activeId) ??
    subscriptions[0];

  return {
    active,
    activeId: activeId ?? active?.id,
    activeSource: sources.find((item) => item.id === active?.source),
    selectedSource: sources.find((item) => item.id === source),
    sources,
    query,
    source,
    busy,
    error,
    setActiveId,
    setQuery,
    setSource,
    create: async () => {
      const clean = query.trim();
      if (clean.length < 2) return;
      await guard(async () => {
        const created = await createVacancySubscription({
          source,
          query: clean,
          cadenceMinutes: 360,
        });
        setActiveId(created.subscription.id);
        setView(created);
        await onRefresh();
      });
    },
    refresh: async (subscriptionId: string) =>
      guard(async () => {
        setView(await refreshVacancySubscription(subscriptionId));
        await onRefresh();
      }),
    toggle: async (subscription: VacancySubscription) =>
      guard(async () => {
        await updateVacancySubscription(
          subscription.id,
          subscription.status === 'active' ? 'paused' : 'active',
        );
        await onRefresh();
      }),
    remove: async (subscriptionId: string) =>
      guard(async () => {
        await deleteVacancySubscription(subscriptionId);
        setActiveId(undefined);
        setView(undefined);
        await onRefresh();
      }),
  };
}
