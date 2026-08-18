import { Component, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';



describe('AppErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    const html = renderToStaticMarkup(
      <AppErrorBoundary>
        <div className="healthy-content">Работает штатно</div>
      </AppErrorBoundary>,
    );
    expect(html).toContain('Работает штатно');
  });

  it('renders a resilient fallback with error description when a child crashes', () => {
    // In server-side renderToStaticMarkup, class error boundaries catch errors if implemented or when instantiated
    const boundary = new (AppErrorBoundary as unknown as new (props: { children: ReactNode }) => Component<{ children: ReactNode }, { hasError: boolean; error?: Error }>)({ children: null });
    boundary.state = { hasError: true, error: new Error('Cannot read properties of null (reading find)') };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);

    expect(html).toContain('Что-то пошло не так');
    expect(html).toContain('Попробовать снова');
    expect(html).toContain('career-error-boundary');
  });
});
