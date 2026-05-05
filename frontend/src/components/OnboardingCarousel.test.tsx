import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OnboardingCarousel from './OnboardingCarousel'

function renderCarousel(
  open: boolean,
  overrides: Partial<{ replay: boolean; onStartExample: () => void; onStartOwnFolder: () => void }> = {},
) {
  const onStartExample = overrides.onStartExample ?? vi.fn()
  const onStartOwnFolder = overrides.onStartOwnFolder ?? vi.fn()
  const utils = render(
    <OnboardingCarousel
      open={open}
      replay={overrides.replay ?? false}
      onStartExample={onStartExample}
      onStartOwnFolder={onStartOwnFolder}
    />,
  )
  return { ...utils, onStartExample, onStartOwnFolder }
}

describe('OnboardingCarousel', () => {
  it('renders nothing when open=false', () => {
    renderCarousel(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a dialog with the first slide when open=true', () => {
    renderCarousel(true)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The pagination indicator shows "1 / N" on the first slide.
    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()
  })

  it('shows "처음 설정" badge when replay=false and "둘러보기 다시 보기" when replay=true', () => {
    const { rerender } = render(
      <OnboardingCarousel open replay={false} onStartExample={() => {}} onStartOwnFolder={() => {}} />,
    )
    expect(screen.getByText('처음 설정')).toBeInTheDocument()

    rerender(
      <OnboardingCarousel open replay={true} onStartExample={() => {}} onStartOwnFolder={() => {}} />,
    )
    expect(screen.getByText('둘러보기 다시 보기')).toBeInTheDocument()
  })

  it('clicking 다음 advances to the next slide', async () => {
    renderCarousel(true)
    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /다음/ }))

    expect(screen.getByText(/^2 \/ \d+$/)).toBeInTheDocument()
  })

  it('ArrowRight key advances and ArrowLeft key goes back', () => {
    renderCarousel(true)
    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()

    fireEvent.keyDown(document.body,{ key: 'ArrowRight' })
    expect(screen.getByText(/^2 \/ \d+$/)).toBeInTheDocument()

    fireEvent.keyDown(document.body,{ key: 'ArrowLeft' })
    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()
  })

  it('ArrowLeft is clamped at the first slide', () => {
    renderCarousel(true)
    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()

    fireEvent.keyDown(document.body,{ key: 'ArrowLeft' })
    fireEvent.keyDown(document.body,{ key: 'ArrowLeft' })

    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()
  })

  it('End key jumps to the last slide and exposes the example/own-folder actions', () => {
    renderCarousel(true)

    fireEvent.keyDown(document.body,{ key: 'End' })

    // Last slide replaces "다음" with "예제로 먼저 보기".
    expect(screen.getByRole('button', { name: '예제로 먼저 보기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument()
  })

  it('Home key returns to the first slide', () => {
    renderCarousel(true)

    fireEvent.keyDown(document.body,{ key: 'End' })
    fireEvent.keyDown(document.body,{ key: 'Home' })

    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()
  })

  it('Escape key triggers onStartOwnFolder', () => {
    const { onStartOwnFolder } = renderCarousel(true)

    fireEvent.keyDown(document.body,{ key: 'Escape' })

    expect(onStartOwnFolder).toHaveBeenCalled()
  })

  it('clicking 예제로 먼저 보기 on the last slide triggers onStartExample', async () => {
    const { onStartExample } = renderCarousel(true)

    fireEvent.keyDown(document.body,{ key: 'End' })
    await userEvent.click(screen.getByRole('button', { name: '예제로 먼저 보기' }))

    expect(onStartExample).toHaveBeenCalled()
  })

  it('clicking the close button (둘러보기 닫기) triggers onStartOwnFolder', async () => {
    const { onStartOwnFolder } = renderCarousel(true)

    await userEvent.click(screen.getByRole('button', { name: '둘러보기 닫기' }))

    expect(onStartOwnFolder).toHaveBeenCalled()
  })

  it('keyboard events are ignored when typing inside an input', () => {
    render(
      <>
        <OnboardingCarousel open replay={false} onStartExample={() => {}} onStartOwnFolder={() => {}} />
        <input data-testid="external-input" />
      </>,
    )

    const input = screen.getByTestId('external-input')
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight' })

    // Slide should not advance because the event originated from an input.
    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()
  })
})
