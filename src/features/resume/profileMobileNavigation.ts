import { useCallback, useReducer } from 'react';
import type { TodayProfileFocus } from '../today/todayApi';

export type ProfileFocusRequest =
  TodayProfileFocus | { readonly section: 'review' | 'ats'; readonly findingId: string };

export type ProfileMobilePage =
  | 'home'
  | 'exp'
  | 'job'
  | 'jobedit'
  | 'jobadd'
  | 'ats'
  | 'check'
  | 'about'
  | 'edu'
  | 'proj'
  | 'lang'
  | 'reloc'
  | 'docs'
  | 'src'
  | 'skilladd'
  | 'contacts'
  | 'certifications'
  | 'recommendations'
  | 'achievements';

export interface ProfileMobileRoute {
  readonly page: ProfileMobilePage;
  readonly entryId?: string;
}

export interface ProfileMobileScene {
  readonly title: string;
  readonly onBack?: () => void;
}

interface MobileNavigationState {
  readonly current: ProfileMobileRoute;
  readonly previous: readonly ProfileMobileRoute[];
}

type MobileNavigationAction =
  { readonly type: 'open'; readonly route: ProfileMobileRoute } | { readonly type: 'back' };

function navigate(
  state: MobileNavigationState,
  action: MobileNavigationAction,
): MobileNavigationState {
  if (action.type === 'back') {
    return {
      current: state.previous.at(-1) ?? { page: 'home' },
      previous: state.previous.slice(0, -1),
    };
  }
  if (state.current.page === action.route.page && state.current.entryId === action.route.entryId)
    return state;
  return { current: action.route, previous: [...state.previous, state.current] };
}

export function useProfileMobileNavigation() {
  const [state, dispatch] = useReducer(navigate, { current: { page: 'home' }, previous: [] });
  const open = useCallback((route: ProfileMobileRoute) => dispatch({ type: 'open', route }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  return { route: state.current, hasBack: state.previous.length > 0, open, back };
}

const PAGE_TITLES: Readonly<Record<ProfileMobilePage, string>> = {
  home: 'Профиль',
  exp: 'Опыт',
  job: 'Место работы',
  jobedit: 'Правка места',
  jobadd: 'Новое место',
  ats: 'Прохождение ATS',
  check: 'Проверка резюме',
  about: 'Обо мне',
  edu: 'Образование',
  proj: 'Проекты',
  lang: 'Языки',
  reloc: 'Релокация',
  docs: 'Версии под вакансии',
  src: 'Источники',
  skilladd: 'Новый навык',
  contacts: 'Контакты',
  certifications: 'Сертификаты',
  recommendations: 'Рекомендации',
  achievements: 'Достижения',
};

export function profileMobileTitle(route: ProfileMobileRoute, employer?: string): string {
  return route.page === 'job' && employer ? employer : PAGE_TITLES[route.page];
}
