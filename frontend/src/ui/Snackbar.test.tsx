import { useEffect } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { SnackbarProvider, useSnackbar } from './Snackbar'

function SnackbarHarness({ mode = 'basic' }: { mode?: 'basic' | 'dedupe' }) {
  const snackbar = useSnackbar()

  useEffect(() => {
    if (mode !== 'basic') return
    snackbar.success('문서 새로고침 완료', 120)
  }, [mode, snackbar])

  return (
    <div>
      <button
        type="button"
        onClick={() => snackbar.show({ key: 'rescan-status', tone: 'warning', message: '문서 새로고침 확인 중' })}
      >
        같은 알림
      </button>
      <button type="button" onClick={() => snackbar.info('대상 폴더를 추가했습니다')}>
        다른 알림
      </button>
    </div>
  )
}

function renderSnackbar(mode?: 'basic' | 'dedupe') {
  return render(
    <SnackbarProvider>
      <SnackbarHarness mode={mode} />
    </SnackbarProvider>,
  )
}

describe('SnackbarProvider', () => {
  it('keeps dismissed toasts in notification history', async () => {
    const user = userEvent.setup()

    renderSnackbar('basic')

    expect(await screen.findByText('문서 새로고침 완료')).toBeInTheDocument()

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 1000 })

    await user.click(screen.getByRole('button', { name: /알림함 열기/ }))
    expect(screen.getByRole('dialog', { name: '알림함' })).toBeInTheDocument()
    expect(screen.getByText('문서 새로고침 완료')).toBeInTheDocument()
  })

  it('deduplicates keyed notifications and records the repeat count', async () => {
    const user = userEvent.setup()

    renderSnackbar('dedupe')

    await user.click(screen.getByRole('button', { name: '같은 알림' }))
    await user.click(screen.getByRole('button', { name: '같은 알림' }))

    expect(screen.getAllByText('문서 새로고침 확인 중')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /알림함 열기/ }))
    expect(screen.getAllByText('문서 새로고침 확인 중')).toHaveLength(2)
    expect(screen.getByText('2회')).toBeInTheDocument()
  })

  it('clears notification history without requiring old toasts to be visible', async () => {
    const user = userEvent.setup()

    renderSnackbar('dedupe')

    await user.click(screen.getByRole('button', { name: '같은 알림' }))
    await user.click(screen.getByRole('button', { name: '다른 알림' }))
    await user.click(screen.getByRole('button', { name: /알림함 열기/ }))

    expect(screen.getByRole('dialog', { name: '알림함' })).toBeInTheDocument()
    expect(screen.getAllByText('문서 새로고침 확인 중').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('대상 폴더를 추가했습니다').length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByRole('button', { name: '모두 지우기' }))

    await user.click(screen.getByRole('button', { name: /알림함 열기/ }))
    expect(screen.getByText('확인할 알림이 없습니다')).toBeInTheDocument()
  })
})
