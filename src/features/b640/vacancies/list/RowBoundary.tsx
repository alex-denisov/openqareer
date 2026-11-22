import { Component, type ReactNode } from 'react';

interface RowBoundaryProps {
  /** Название вакансии: строка-замена показывает хотя бы его. */
  readonly title: string;
  readonly children: ReactNode;
}

/**
 * Сбой одной строки таблицы не роняет раздел: вместо строки — её название. Данные строк
 * приходят из десятков источников, и одна кривая вакансия не должна закрывать подборку.
 */
export class RowBoundary extends Component<RowBoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <tr className="vt-row">
        <td className="vt-c vt-role" colSpan={8}>
          {this.props.title}
        </td>
      </tr>
    );
  }
}
