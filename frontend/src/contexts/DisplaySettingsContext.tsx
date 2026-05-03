import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type AppTextSize = 'normal' | 'large' | 'xlarge' | 'xxlarge'
export type AppThemeMode = 'system' | 'light' | 'dark'
export type ResolvedAppTheme = 'light' | 'dark'

export const APP_TEXT_SIZE_KEY = 'officewhere:app-text-size'
export const APP_THEME_MODE_KEY = 'officewhere:theme-mode'
const LEGACY_VERSION_TEXT_SIZE_KEY = 'officewhere:version-view-size'

export const APP_TEXT_SIZE_LABELS: Record<AppTextSize, string> = {
  normal: '기본',
  large: '크게',
  xlarge: '더 크게',
  xxlarge: '아주 크게',
}

export const APP_TEXT_SIZE_DESCRIPTIONS: Record<AppTextSize, string> = {
  normal: '기본 화면 크기',
  large: '목록과 비교 내용이 조금 더 크게 보입니다.',
  xlarge: '문서 비교와 표 내용을 넉넉하게 읽을 수 있습니다.',
  xxlarge: '가장 큰 글자 크기입니다. 표는 가로 스크롤로 확인하세요.',
}

export const APP_TEXT_SIZE_ORDER: AppTextSize[] = ['normal', 'large', 'xlarge', 'xxlarge']

export const APP_THEME_MODE_LABELS: Record<AppThemeMode, string> = {
  system: '시스템',
  light: '라이트',
  dark: '다크',
}

export const APP_THEME_MODE_DESCRIPTIONS: Record<AppThemeMode, string> = {
  system: '운영체제 설정을 따라갑니다.',
  light: '문서 앱처럼 밝고 차분하게 표시합니다.',
  dark: '어두운 환경에서 표와 변경점을 또렷하게 봅니다.',
}

export const APP_THEME_MODE_ORDER: AppThemeMode[] = ['system', 'light', 'dark']

interface DisplaySettingsContextValue {
  textSize: AppTextSize
  setTextSize: (textSize: AppTextSize) => void
  increaseTextSize: () => void
  decreaseTextSize: () => void
  resetTextSize: () => void
  themeMode: AppThemeMode
  resolvedTheme: ResolvedAppTheme
  setThemeMode: (mode: AppThemeMode) => void
  resetThemeMode: () => void
}

const DisplaySettingsContext = createContext<DisplaySettingsContextValue | null>(null)

function readInitialTextSize(): AppTextSize {
  if (typeof window === 'undefined') return 'normal'
  const stored =
    window.localStorage.getItem(APP_TEXT_SIZE_KEY) ??
    window.localStorage.getItem(LEGACY_VERSION_TEXT_SIZE_KEY)
  return APP_TEXT_SIZE_ORDER.includes(stored as AppTextSize) ? (stored as AppTextSize) : 'normal'
}

function readInitialThemeMode(): AppThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(APP_THEME_MODE_KEY)
  return APP_THEME_MODE_ORDER.includes(stored as AppThemeMode) ? (stored as AppThemeMode) : 'system'
}

function getSystemTheme(): ResolvedAppTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveThemeMode(mode: AppThemeMode, systemTheme: ResolvedAppTheme): ResolvedAppTheme {
  return mode === 'system' ? systemTheme : mode
}

function moveTextSize(current: AppTextSize, direction: -1 | 1): AppTextSize {
  const currentIndex = APP_TEXT_SIZE_ORDER.indexOf(current)
  const nextIndex = Math.min(
    APP_TEXT_SIZE_ORDER.length - 1,
    Math.max(0, currentIndex + direction),
  )
  return APP_TEXT_SIZE_ORDER[nextIndex]
}

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [textSize, setTextSize] = useState<AppTextSize>(readInitialTextSize)
  const [themeMode, setThemeMode] = useState<AppThemeMode>(readInitialThemeMode)
  const [systemTheme, setSystemTheme] = useState<ResolvedAppTheme>(getSystemTheme)
  const resolvedTheme = resolveThemeMode(themeMode, systemTheme)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemTheme(media.matches ? 'dark' : 'light')
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(APP_TEXT_SIZE_KEY, textSize)
  }, [textSize])

  useEffect(() => {
    window.localStorage.setItem(APP_THEME_MODE_KEY, themeMode)
  }, [themeMode])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = themeMode
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme, themeMode])

  const value = useMemo<DisplaySettingsContextValue>(
    () => ({
      textSize,
      setTextSize,
      increaseTextSize: () => setTextSize((current) => moveTextSize(current, 1)),
      decreaseTextSize: () => setTextSize((current) => moveTextSize(current, -1)),
      resetTextSize: () => setTextSize('normal'),
      themeMode,
      resolvedTheme,
      setThemeMode,
      resetThemeMode: () => setThemeMode('system'),
    }),
    [resolvedTheme, textSize, themeMode],
  )

  return (
    <DisplaySettingsContext.Provider value={value}>
      {children}
    </DisplaySettingsContext.Provider>
  )
}

export function useDisplaySettings() {
  const value = useContext(DisplaySettingsContext)
  if (!value) throw new Error('useDisplaySettings must be used inside DisplaySettingsProvider')
  return value
}
