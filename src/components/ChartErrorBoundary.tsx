import { Component, type ReactNode } from 'react'

interface Props {
  /** Changing this (e.g. market + interval) clears a previous error. */
  resetKey: string
  children: ReactNode
}

interface State {
  error: Error | null
  resetKey: string
}

/**
 * Keeps a failure inside one chart from blanking the whole app: the cell shows
 * a message with a retry button, and the header / market list keep working.
 */
export default class ChartErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Switching market/interval gives the chart a fresh start.
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error) {
    console.error('Chart crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="chart-error" role="alert">
        <p>차트를 표시하는 중 문제가 생겼습니다.</p>
        <button className="tb-btn" onClick={() => this.setState({ error: null })}>
          다시 시도
        </button>
      </div>
    )
  }
}
