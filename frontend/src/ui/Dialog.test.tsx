import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={() => {}} title="확인">
        본문
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title and body when open', () => {
    render(
      <Dialog open onClose={() => {}} title="확인">
        본문
      </Dialog>,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('확인')).toBeInTheDocument()
    expect(screen.getByText('본문')).toBeInTheDocument()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="확인">
        본문
      </Dialog>,
    )

    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    document.dispatchEvent(event)

    expect(onClose).toHaveBeenCalled()
  })

  it('locks body scroll while open and restores on unmount', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(
      <Dialog open onClose={() => {}}>
        본문
      </Dialog>,
    )
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('calls onClose when the backdrop is clicked (dismissOnBackdrop default)', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose}>
        <span data-testid="dialog-body">본문</span>
      </Dialog>,
    )

    const backdrop = screen.getByRole('dialog')
    await userEvent.pointer({ keys: '[MouseLeft>]', target: backdrop })

    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when dismissOnBackdrop is false', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} dismissOnBackdrop={false}>
        본문
      </Dialog>,
    )
    await userEvent.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('dialog') })

    expect(onClose).not.toHaveBeenCalled()
  })
})
