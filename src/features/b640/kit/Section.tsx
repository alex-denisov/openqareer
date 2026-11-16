import type { ReactNode } from 'react';

export function Section({
  name,
  title,
  children,
}: {
  name: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="kit-section" data-kit={name}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
