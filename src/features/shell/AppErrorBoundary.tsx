import { Component, type ErrorInfo, type ReactNode } from 'react';
import { WarningCircle, ArrowClockwise } from '@phosphor-icons/react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class AppErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Error state is captured in getDerivedStateFromError
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: undefined });
    if (this.props.onReset) {
      this.props.onReset();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="career-error-boundary" role="alert" aria-live="assertive">
          <div className="career-error-boundary-card">
            <div className="career-error-boundary-icon">
              <WarningCircle size={40} weight="duotone" />
            </div>
            <h2>{this.props.fallbackTitle ?? 'Что-то пошло не так'}</h2>
            <p>
              {this.props.fallbackMessage ??
                'Произошла непредвиденная ошибка при отображении раздела. Ваши сохранённые данные в безопасности.'}
            </p>
            {this.state.error?.message ? (
              <details className="career-error-boundary-details">
                <summary>Технические подробности</summary>
                <code>{this.state.error.message}</code>
              </details>
            ) : null}
            <div className="career-error-boundary-actions">
              <button
                type="button"
                className="career-button is-primary"
                onClick={this.handleReset}
              >
                <ArrowClockwise size={16} />
                Попробовать снова
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
