import { createContext, useContext, type ReactNode } from 'react';
import { roleLabel, type RoleTitlesRu } from './roleLabel';

const RoleTitlesContext = createContext<RoleTitlesRu>({});

/** B737: русские названия ролей поиска для экранов, где роль показана по её ключу. */
export function RoleTitlesProvider({
  titlesRu,
  children,
}: {
  readonly titlesRu: RoleTitlesRu | undefined;
  readonly children: ReactNode;
}) {
  return <RoleTitlesContext.Provider value={titlesRu ?? {}}>{children}</RoleTitlesContext.Provider>;
}

/** Название роли для кандидата: русское, если оно есть, иначе исходное. */
export function useRoleLabel(): (title: string) => string {
  const titlesRu = useContext(RoleTitlesContext);
  return (title) => roleLabel(title, titlesRu);
}
