import React from 'react';

export interface ToolCrumb {
  readonly label: string;
  readonly href?: string;
}

export const TOOLS_CRUMB: Required<ToolCrumb> = { label: 'Инструменты', href: '/#tools' };

/**
 * B574: crumbs of every /tools/* page — «Главная / Инструменты / <страница>»,
 * one line of `--career-text-xs` right under the header (mockups 03, 04a, 05,
 * 07). Every step links except the last, the current page.
 * `wrapped` — the page already sits inside `.ps-wrap`.
 */
export function ToolCrumbs({
  trail,
  wrapped = false,
}: {
  readonly trail: readonly ToolCrumb[];
  readonly wrapped?: boolean;
}) {
  const steps: readonly ToolCrumb[] = [{ label: 'Главная', href: '/' }, TOOLS_CRUMB, ...trail];
  return (
    <nav
      className={wrapped ? 'ps-tool-crumbs' : 'ps-wrap ps-tool-crumbs'}
      aria-label="Хлебные крошки"
    >
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <React.Fragment key={step.label}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {last || !step.href ? (
              <span aria-current={last ? 'page' : undefined}>{step.label}</span>
            ) : (
              <a href={step.href}>{step.label}</a>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
