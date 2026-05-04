import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders children as the accessible name', () => {
    render(<Button>비교</Button>)
    expect(screen.getByRole('button', { name: '비교' })).toBeInTheDocument()
  })

  it('defaults to type=button to avoid accidental form submits', () => {
    render(<Button>저장</Button>)
    expect(screen.getByRole('button', { name: '저장' })).toHaveAttribute('type', 'button')
  })

  it('respects an explicit type=submit', () => {
    render(<Button type="submit">제출</Button>)
    expect(screen.getByRole('button', { name: '제출' })).toHaveAttribute('type', 'submit')
  })

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>실행</Button>)
    await userEvent.click(screen.getByRole('button', { name: '실행' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        실행
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: '실행' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('disables itself while loading', () => {
    render(<Button loading>저장</Button>)
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })
})
