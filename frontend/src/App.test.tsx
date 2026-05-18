import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithProviders, screen } from './test/utils'

vi.mock('./components/FileManager', () => ({
  default: vi.fn(() => <div data-testid="file-manager">설정 탭</div>),
}))

vi.mock('./components/FileSearch', () => ({
  default: vi.fn(() => <div data-testid="file-search">검색 탭</div>),
}))

vi.mock('./components/ConsistencyCheck', () => ({
  default: vi.fn(() => <div data-testid="consistency-check">이력 탭</div>),
}))

vi.mock('./components/DuplicateFiles', () => ({
  default: vi.fn(() => <div data-testid="duplicate-files">중복 탭</div>),
}))

import App from './App'

describe('App startup tab mounting', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('officewhere:onboarding-complete:v1', 'true')
  })

  it('mounts only the active tab on startup and lazily mounts settings when opened', async () => {
    renderWithProviders(<App />)

    expect(await screen.findByTestId('file-search')).toBeInTheDocument()
    expect(screen.queryByTestId('file-manager')).not.toBeInTheDocument()
    expect(screen.queryByTestId('consistency-check')).not.toBeInTheDocument()
    expect(screen.queryByTestId('duplicate-files')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /설정/ }))

    expect(await screen.findByTestId('file-manager')).toBeInTheDocument()
    expect(screen.getByTestId('file-search')).toBeInTheDocument()
  })
})
