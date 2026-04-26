import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type AppTextSize = 'normal' | 'large' | 'xlarge' | 'xxlarge'

export const APP_TEXT_SIZE_KEY = 'officewhere:app-text-size'
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

interface DisplaySettingsContextValue {
  textSize: AppTextSize
  setTextSize: (textSize: AppTextSize) => void
  increaseTextSize: () => void
  decreaseTextSize: () => void
  resetTextSize: () => void
}

const DisplaySettingsContext = createContext<DisplaySettingsContextValue | null>(null)

function readInitialTextSize(): AppTextSize {
  if (typeof window === 'undefined') return 'normal'
  const stored =
    window.localStorage.getItem(APP_TEXT_SIZE_KEY) ??
    window.localStorage.getItem(LEGACY_VERSION_TEXT_SIZE_KEY)
  return APP_TEXT_SIZE_ORDER.includes(stored as AppTextSize) ? (stored as AppTextSize) : 'normal'
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

  useEffect(() => {
    window.localStorage.setItem(APP_TEXT_SIZE_KEY, textSize)
  }, [textSize])

  const value = useMemo<DisplaySettingsContextValue>(
    () => ({
      textSize,
      setTextSize,
      increaseTextSize: () => setTextSize((current) => moveTextSize(current, 1)),
      decreaseTextSize: () => setTextSize((current) => moveTextSize(current, -1)),
      resetTextSize: () => setTextSize('normal'),
    }),
    [textSize],
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
