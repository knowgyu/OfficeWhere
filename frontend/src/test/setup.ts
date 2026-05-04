import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './msw/server'

// jsdom polyfills — only the APIs that jsdom does not implement.
// window.officeWhere is intentionally NOT auto-injected here. Tests that
// depend on the Electron preload bridge must opt in via installBridge().
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})

class IntersectionObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
  root: Element | null = null
  rootMargin = ''
  thresholds: ReadonlyArray<number> = []
}

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

;(globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
  IntersectionObserverMock as unknown as typeof IntersectionObserver
;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver

// MSW lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  delete (window as { officeWhere?: unknown }).officeWhere
  window.localStorage.clear()
  // transport.ts caches getBackendBaseUrl() at the module level; reset between
  // tests so a previous bridge mock does not leak.
  void import('../api/transport').then((mod) => mod.__resetForTests?.())
})

afterAll(() => server.close())
