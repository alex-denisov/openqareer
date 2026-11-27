import { Component, createElement, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Button } from '../kit/Button';
import { retryChunk, type RetryableChunk } from './chunk';

interface Chunk {
  readonly load: () => Promise<unknown>;
  readonly forgetFailure: () => void;
}

interface FailureProps {
  readonly chunk: Chunk;
  readonly onRecovered: () => void;
}

function ChunkFailure({ chunk, onRecovered }: FailureProps) {
  const [busy, setBusy] = useState(false);
  // Ушли на другой адрес, пока ждали ответа: его не перезагружаем.
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  const reload = () => {
    if (shown.current) window.location.reload();
  };
  const retry = async () => {
    setBusy(true);
    const recovered = await retryChunk(chunk, reload);
    setBusy(false);
    if (!recovered) return;
    chunk.forgetFailure();
    onRecovered();
  };
  return (
    <section className="b640-stub" role="alert">
      <h2>Что-то пошло не так</h2>
      <Button variant="primary" busy={busy} onClick={() => void retry()}>
        Попробовать снова
      </Button>
    </section>
  );
}

interface Props {
  readonly chunk: Chunk;
  /** Смена значения (адрес) снимает ошибку. */
  readonly resetKey: string;
  readonly children: ReactNode;
  /** Рамка сообщения: страница раздела или панель. */
  readonly frame: (failure: ReactNode) => ReactNode;
}

interface State {
  readonly failed: boolean;
  readonly resetKey: string;
}

/** Граница ошибки внутри каркаса: навигация остаётся, другой адрес открывается как обычно. */
export class ChunkBoundary extends Component<Props, State> {
  public override state: State = { failed: false, resetKey: this.props.resetKey };

  public static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  public static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  public override componentDidCatch(): void {
    // Ошибка уже показана: следующий показ раздела запросит кусок заново.
    this.props.chunk.forgetFailure();
  }

  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return this.props.frame(
      <ChunkFailure chunk={this.props.chunk} onRecovered={() => this.setState({ failed: false })} />,
    );
  }
}

interface ChunkViewProps<P> {
  readonly chunk: RetryableChunk<P>;
  readonly props: P;
}

/** Рисует кусок; после сбоя — уже новый `lazy`. */
export function ChunkView<P extends object>({ chunk, props }: ChunkViewProps<P>) {
  return createElement(chunk.component() as unknown as ComponentType<P>, props);
}
