import type { ReactNode } from 'react';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { CtxHead } from '../shell/CtxHead';
import { vacancyName } from '../shell/vacancyNames';
import { parseStep } from './model/applyModel';
import { VacancyColumn, type VacancyColumnProps } from './VacancyColumn';

/** Название, с которым отклик открыли: по нему путь и колонка стоят до ответа сервера. */
export function useOpenedName(): string | null {
  const vacancy = useShell().journey?.vacancy;
  return vacancy ? vacancyName(vacancy) : null;
}

interface PendingProps {
  readonly children: ReactNode;
  readonly loading?: boolean;
  readonly fallbacks?: VacancyColumnProps['fallbacks'];
}

/** Отклик ещё читается: шапка и текст вакансии уже на месте, если вакансия известна. */
export function Pending({ children, loading = false, fallbacks }: PendingProps) {
  const { journey, search } = useShell();
  const vacancy = journey?.vacancy;
  const step = parseStep(search);
  const wide = Boolean(vacancy) && loading && (step === 'letter' || step === 'resume');
  useScreenChrome({
    ...(vacancy ? { crumb: vacancy.title } : {}),
    rootData: wide ? { 'main-right': '1', ...(step === 'letter' ? { mtight: '1' } : {}) } : {},
  });
  return (
    <div
      className={wide ? 'page two split-editor' : 'page two'}
      data-b640-node="o02"
      data-b640-section="apply"
    >
      {vacancy ? <CtxHead kind="Отклик" title={vacancyName(vacancy)} /> : null}
      {wide && vacancy ? (
        <>
          <VacancyColumn head={{ title: vacancy.title, source: null }} fallbacks={fallbacks} waiting />
          <div className="col">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
