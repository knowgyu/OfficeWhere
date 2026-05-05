import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  APP_TEXT_SIZE_KEY,
  APP_THEME_MODE_KEY,
  DisplaySettingsProvider,
  useDisplaySettings,
} from './DisplaySettingsContext'

function withProvider({ children }: { children: React.ReactNode }) {
  return <DisplaySettingsProvider>{children}</DisplaySettingsProvider>
}

describe('DisplaySettingsProvider', () => {
  describe('text size', () => {
    it('starts at "normal" when localStorage is empty', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })
      expect(result.current.textSize).toBe('normal')
    })

    it('hydrates from localStorage', () => {
      window.localStorage.setItem(APP_TEXT_SIZE_KEY, 'large')

      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      expect(result.current.textSize).toBe('large')
    })

    it('falls back to legacy key when the current key is missing', () => {
      window.localStorage.setItem('officewhere:version-view-size', 'xlarge')

      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      expect(result.current.textSize).toBe('xlarge')
    })

    it('ignores unknown stored values and resets to normal', () => {
      window.localStorage.setItem(APP_TEXT_SIZE_KEY, 'gigantic')

      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      expect(result.current.textSize).toBe('normal')
    })

    it('moves through the size order on increase/decrease', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      act(() => result.current.increaseTextSize())
      expect(result.current.textSize).toBe('large')

      act(() => result.current.increaseTextSize())
      expect(result.current.textSize).toBe('xlarge')

      act(() => result.current.decreaseTextSize())
      expect(result.current.textSize).toBe('large')
    })

    it('clamps at the boundaries (cannot go below normal or above xxlarge)', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      act(() => result.current.decreaseTextSize())
      expect(result.current.textSize).toBe('normal')

      act(() => {
        result.current.setTextSize('xxlarge')
      })
      act(() => result.current.increaseTextSize())
      expect(result.current.textSize).toBe('xxlarge')
    })

    it('persists changes to localStorage', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      act(() => result.current.setTextSize('xlarge'))

      expect(window.localStorage.getItem(APP_TEXT_SIZE_KEY)).toBe('xlarge')
    })

    it('resetTextSize returns to normal', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })
      act(() => result.current.setTextSize('xxlarge'))
      act(() => result.current.resetTextSize())

      expect(result.current.textSize).toBe('normal')
    })
  })

  describe('theme mode', () => {
    it('defaults to system mode', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })
      expect(result.current.themeMode).toBe('system')
    })

    it('resolves system mode against matchMedia (light when prefers-color-scheme: dark is false)', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })
      // setup.ts's matchMedia mock returns matches: false → light
      expect(result.current.resolvedTheme).toBe('light')
    })

    it('explicit light/dark overrides system', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      act(() => result.current.setThemeMode('dark'))
      expect(result.current.resolvedTheme).toBe('dark')

      act(() => result.current.setThemeMode('light'))
      expect(result.current.resolvedTheme).toBe('light')
    })

    it('persists themeMode to localStorage', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      act(() => result.current.setThemeMode('dark'))

      expect(window.localStorage.getItem(APP_THEME_MODE_KEY)).toBe('dark')
    })

    it('writes resolvedTheme onto document.documentElement.dataset.theme', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })

      act(() => result.current.setThemeMode('dark'))

      expect(document.documentElement.dataset.theme).toBe('dark')
      expect(document.documentElement.dataset.themeMode).toBe('dark')
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('resetThemeMode returns to system', () => {
      const { result } = renderHook(() => useDisplaySettings(), { wrapper: withProvider })
      act(() => result.current.setThemeMode('dark'))
      act(() => result.current.resetThemeMode())

      expect(result.current.themeMode).toBe('system')
    })
  })
})
