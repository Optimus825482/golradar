'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logError } from '@/lib/devLog'

interface Props {
  children: ReactNode
  fallback?: ReactNode | ((props: { retry: () => void; error: Error }) => ReactNode)
  context?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Generic Error Boundary component.
 * Wraps error-prone components (charts, analytics panels, etc.)
 * so a crash doesn't take down the entire page.
 *
 * Usage:
 *   <ErrorBoundary context="MomentumChart" fallback={<p>Chart unavailable</p>}>
 *     <MomentumChart />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const ctx = this.props.context || 'ErrorBoundary'
    logError(ctx, error, errorInfo.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({ retry: this.handleRetry, error: this.state.error! })
      }
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs mb-2">Bileşen yüklenemedi</p>
            <button
              onClick={this.handleRetry}
              className="text-[11px] px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
            >
              Tekrar Dene
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
