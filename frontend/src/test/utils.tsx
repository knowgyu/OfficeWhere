import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { SnackbarProvider } from '../ui'
import { DisplaySettingsProvider } from '../contexts/DisplaySettingsContext'
import { LibraryRescanProvider } from '../contexts/LibraryRescanContext'

interface ProviderOptions {
  /**
   * Skip the LibraryRescanProvider. Tests for components that mock the
   * rescan context directly should pass `withLibraryRescan: false` to avoid
   * the real provider's initial /api/library/rescan/status fetch.
   */
  withLibraryRescan?: boolean
}

function AllProviders({ children, withLibraryRescan = true }: { children: ReactNode } & ProviderOptions) {
  const inner = withLibraryRescan ? <LibraryRescanProvider>{children}</LibraryRescanProvider> : children
  return (
    <SnackbarProvider>
      <DisplaySettingsProvider>{inner}</DisplaySettingsProvider>
    </SnackbarProvider>
  )
}

/**
 * Render a component wrapped in the same providers as <App />. Pass
 * `withLibraryRescan: false` for tests that mock the rescan context.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions & ProviderOptions = {},
): RenderResult {
  const { withLibraryRescan, ...renderOptions } = options
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders withLibraryRescan={withLibraryRescan}>{children}</AllProviders>
    ),
    ...renderOptions,
  })
}

export * from '@testing-library/react'
