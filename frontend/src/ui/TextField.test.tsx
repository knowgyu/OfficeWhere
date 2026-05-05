import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextField } from './TextField'

describe('TextField', () => {
  it('associates label with input via htmlFor/id', () => {
    render(<TextField label="검색어" placeholder="입력" />)
    const input = screen.getByLabelText('검색어')
    expect(input).toBeInTheDocument()
  })

  it('uses an explicit id when provided', () => {
    render(<TextField id="my-field" label="검색어" />)
    expect(screen.getByLabelText('검색어')).toHaveAttribute('id', 'my-field')
  })

  it('renders helper text when no error', () => {
    render(<TextField label="이름" helper="실명을 입력해 주세요" />)
    expect(screen.getByText('실명을 입력해 주세요')).toBeInTheDocument()
  })

  it('replaces helper with error message when error is set', () => {
    render(<TextField label="이름" helper="도움말" error="필수 입력입니다" />)
    expect(screen.getByText('필수 입력입니다')).toBeInTheDocument()
    expect(screen.queryByText('도움말')).not.toBeInTheDocument()
  })

  it('forwards typed input to onChange', async () => {
    const onChange = vi.fn()
    render(<TextField label="검색" onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('검색'), '회의')

    expect(onChange).toHaveBeenCalled()
    // Last call sees the full controlled-style value path; uncontrolled here,
    // so we verify the user's typed text is in the input.
    expect(screen.getByLabelText<HTMLInputElement>('검색').value).toBe('회의')
  })

  it('respects disabled state', async () => {
    const onChange = vi.fn()
    render(<TextField label="검색" disabled onChange={onChange} />)

    const input = screen.getByLabelText<HTMLInputElement>('검색')
    expect(input).toBeDisabled()

    await userEvent.type(input, 'x')
    expect(onChange).not.toHaveBeenCalled()
  })
})
