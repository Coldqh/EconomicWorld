import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null; reference: string }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reference: "" };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      reference: `EW-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ECONOMIC WORLD render failure", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-screen" role="alert">
        <span>ОШИБКА ИНТЕРФЕЙСА · {this.state.reference}</span>
        <h1>Мир не был изменён</h1>
        <p>Перезагрузите приложение. Последняя исправная контрольная точка будет восстановлена автоматически.</p>
        <button className="primary" onClick={() => window.location.reload()}>Перезагрузить</button>
        <details>
          <summary>Технические сведения</summary>
          <code>{this.state.error.message}</code>
        </details>
      </main>
    );
  }
}
