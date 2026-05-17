import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { AppStartupSettings, CloseBehavior, QuickSearchSettings, QuickSearchSettingsPatch } from '../../api/client'
import {
  APP_TEXT_SIZE_DESCRIPTIONS,
  APP_TEXT_SIZE_LABELS,
  APP_TEXT_SIZE_ORDER,
  APP_THEME_MODE_DESCRIPTIONS,
  APP_THEME_MODE_LABELS,
  APP_THEME_MODE_ORDER,
} from '../../contexts/DisplaySettingsContext'
import type { AppTextSize, AppThemeMode, ResolvedAppTheme } from '../../contexts/DisplaySettingsContext'
import { Button, Card, CardSection, EmptyState, Icon, SelectField, Switch } from '../../ui'

type GeneralSettingsSectionProps = {
  textSize: AppTextSize
  themeMode: AppThemeMode
  resolvedTheme: ResolvedAppTheme
  closeBehavior: CloseBehavior
  closeBehaviorLabels: Record<CloseBehavior, string>
  closeBehaviorAvailable: boolean
  closeBehaviorLoading: boolean
  startupSettings: AppStartupSettings
  startupSettingsAvailable: boolean
  startupSettingsLoading: boolean
  quickSearchSettings: QuickSearchSettings
  quickSearchSettingsAvailable: boolean
  quickSearchOpenAvailable: boolean
  quickSearchSettingsLoading: boolean
  onTextSizeChange: (size: AppTextSize) => void
  onThemeModeChange: (mode: AppThemeMode) => void
  onCloseBehaviorChange: (behavior: CloseBehavior) => void
  onStartupSettingsChange: (enabled: boolean) => void
  onQuickSearchSettingsChange: (settings: QuickSearchSettingsPatch) => void
  onOpenQuickSearch: () => void
}

const QUICK_SEARCH_SHORTCUT_OPTIONS = [
  {
    accelerator: 'CommandOrControl+Alt+F',
    badge: '추천',
    description: 'Space 계열 OS/IME 충돌을 피한 기본 조합입니다.',
  },
  {
    accelerator: 'CommandOrControl+Alt+Space',
    description: '검색창 호출 느낌을 살리고 싶을 때 쓰는 대안입니다.',
  },
  {
    accelerator: 'CommandOrControl+Shift+F',
    description: 'Alt 조합이 이미 다른 앱과 겹칠 때 선택합니다.',
  },
]

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

const ELECTRON_ACCELERATOR_KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Backspace: 'Backspace',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Home: 'Home',
  Insert: 'Insert',
  Space: 'Space',
  Tab: 'Tab',
}

type ShortcutCaptureResult =
  | { status: 'valid'; accelerator: string }
  | { status: 'cancel' }
  | { status: 'pending' }
  | { status: 'ignore' }
  | { status: 'invalid'; message: string }

function formatAcceleratorLabel(accelerator: string, preferCommandLabel: boolean) {
  const keyLabel: Record<string, string> = {
    CommandOrControl: preferCommandLabel ? 'Cmd' : 'Ctrl',
    Command: 'Cmd',
    Cmd: 'Cmd',
    Control: 'Ctrl',
    Ctrl: 'Ctrl',
    Alt: 'Alt',
    Option: 'Alt',
    Shift: 'Shift',
    Space: 'Space',
    Super: preferCommandLabel ? 'Cmd' : 'Super',
  }
  return accelerator
    .split('+')
    .map((part) => keyLabel[part] ?? part)
    .join(' + ')
}

function shortcutParts(label: string) {
  return label
    .replace(/[\u2318\u2325\u21e7]/g, '')
    .split(' + ')
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeAcceleratorKey(key: string) {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return key
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase()
  return ELECTRON_ACCELERATOR_KEY_ALIASES[key] ?? ''
}

function acceleratorFromKeyboardEvent(event: ReactKeyboardEvent<HTMLElement>): ShortcutCaptureResult {
  if (event.nativeEvent.isComposing) return { status: 'ignore' }
  if (event.key === 'Escape') return { status: 'cancel' }
  if (MODIFIER_KEYS.has(event.key)) return { status: 'pending' }

  const mainKey = normalizeAcceleratorKey(event.key)
  if (!mainKey) {
    return {
      status: 'invalid',
      message: '문자, 숫자, Space, Enter, Tab, 방향키, F1-F24 중 하나를 함께 눌러 주세요.',
    }
  }

  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  if (parts.length === 0) {
    return { status: 'invalid', message: 'Ctrl 또는 Cmd, Alt, Shift 중 하나 이상과 키를 함께 눌러 주세요.' }
  }

  parts.push(mainKey)
  return { status: 'valid', accelerator: parts.join('+') }
}

export default function GeneralSettingsSection({
  textSize,
  themeMode,
  resolvedTheme,
  closeBehavior,
  closeBehaviorLabels,
  closeBehaviorAvailable,
  closeBehaviorLoading,
  startupSettings,
  startupSettingsAvailable,
  startupSettingsLoading,
  quickSearchSettings,
  quickSearchSettingsAvailable,
  quickSearchOpenAvailable,
  quickSearchSettingsLoading,
  onTextSizeChange,
  onThemeModeChange,
  onCloseBehaviorChange,
  onStartupSettingsChange,
  onQuickSearchSettingsChange,
  onOpenQuickSearch,
}: GeneralSettingsSectionProps) {
  const [shortcutCaptureActive, setShortcutCaptureActive] = useState(false)
  const [shortcutCaptureMessage, setShortcutCaptureMessage] = useState('')
  const selectedPreset = QUICK_SEARCH_SHORTCUT_OPTIONS.some(
    (option) => option.accelerator === quickSearchSettings.accelerator,
  )
  const preferCommandLabel = quickSearchSettings.displayShortcut.includes('Cmd')
  const currentShortcutLabel = quickSearchSettings.displayShortcut ||
    formatAcceleratorLabel(quickSearchSettings.accelerator, preferCommandLabel)

  const startShortcutCapture = () => {
    setShortcutCaptureActive(true)
    setShortcutCaptureMessage('새 단축키를 그대로 누르세요. Esc를 누르면 취소합니다.')
  }

  const handleShortcutCaptureKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!shortcutCaptureActive) return
    event.preventDefault()
    event.stopPropagation()

    const result = acceleratorFromKeyboardEvent(event)
    if (result.status === 'ignore' || result.status === 'pending') return
    if (result.status === 'cancel') {
      setShortcutCaptureActive(false)
      setShortcutCaptureMessage('단축키 지정을 취소했습니다.')
      return
    }
    if (result.status === 'invalid') {
      setShortcutCaptureMessage(result.message)
      return
    }

    setShortcutCaptureActive(false)
    setShortcutCaptureMessage('단축키를 저장하고 전역 등록을 다시 확인합니다.')
    onQuickSearchSettingsChange({ accelerator: result.accelerator })
  }

  return (
    <Card variant="elevated" className="console-panel overflow-hidden">
      <CardSection
        title="표시 설정과 앱 동작"
        description="화면 모드, 글자 크기, 창 닫기, 시작프로그램, 빠른 검색을 한 줄 흐름으로 정리합니다."
        className="p-4 md:p-5"
      >
        <div className="space-y-3">
          <section className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-3.5">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">테마</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  현재 적용: {resolvedTheme === 'dark' ? '다크' : '라이트'}
                </p>
              </div>
              <Icon
                name={resolvedTheme === 'dark' ? 'dark_mode' : 'light_mode'}
                size={20}
                className="text-[var(--md-sys-color-primary)]"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {APP_THEME_MODE_ORDER.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onThemeModeChange(mode)}
                  className={`state-host relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    themeMode === mode
                      ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/45 text-[var(--md-sys-color-on-primary-container)]'
                      : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                  }`}
                  aria-pressed={themeMode === mode}
                >
                  <span className="state-layer" />
                  <span className="relative flex items-center justify-between gap-2">
                    <span className="type-label-lg">{APP_THEME_MODE_LABELS[mode]}</span>
                    {themeMode === mode && <Icon name="check_circle" size={17} filled />}
                  </span>
                  <span className="relative mt-0.5 block type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {APP_THEME_MODE_DESCRIPTIONS[mode]}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-3.5">
            <div className="mb-2.5">
              <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">글자 크기</p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                Ctrl 또는 Cmd + 마우스휠, Ctrl 또는 Cmd +/- 로도 조정할 수 있습니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {APP_TEXT_SIZE_ORDER.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onTextSizeChange(size)}
                  className={`state-host relative rounded-lg border px-3 py-2 text-left transition-colors ${
                    textSize === size
                      ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/45'
                      : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                  }`}
                  aria-pressed={textSize === size}
                >
                  <span className="state-layer" />
                  <span className="relative flex items-center justify-between gap-2">
                    <span className="type-label-md text-[var(--md-sys-color-on-surface)]">
                      {APP_TEXT_SIZE_LABELS[size]}
                    </span>
                    {textSize === size && (
                      <Icon name="check_circle" size={17} filled className="text-[var(--md-sys-color-primary)]" />
                    )}
                  </span>
                  <span className="relative mt-0.5 block text-xs text-[var(--md-sys-color-on-surface-variant)]">
                    {APP_TEXT_SIZE_DESCRIPTIONS[size]}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-3.5">
            <div className="mb-2.5 flex items-start gap-2.5">
              <Icon
                name={closeBehavior === 'quit' ? 'power_settings_new' : 'move_to_inbox'}
                size={20}
                className="mt-0.5 text-[var(--md-sys-color-primary)]"
              />
              <div>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">창 닫기 동작</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  X 버튼을 눌렀을 때 백그라운드에 남을지 정합니다.
                </p>
              </div>
            </div>
            {!closeBehaviorAvailable ? (
              <EmptyState
                icon="desktop_windows"
                title="데스크톱 앱에서만 사용할 수 있습니다"
                description="현재 실행 환경에서는 트레이와 창 닫기 동작을 제어할 수 없습니다."
                compact
              />
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,22rem)_1fr] md:items-start">
                <SelectField
                  label="X 버튼 동작"
                  value={closeBehavior}
                  onChange={(event) => onCloseBehaviorChange(event.target.value as CloseBehavior)}
                  disabled={closeBehaviorLoading}
                  helper="트레이로 보내면 창만 닫고 백그라운드 실행을 유지합니다."
                >
                  <option value="ask">{closeBehaviorLabels.ask}</option>
                  <option value="hide">{closeBehaviorLabels.hide}</option>
                  <option value="quit">{closeBehaviorLabels.quit}</option>
                </SelectField>
                <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2.5">
                  <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">현재 설정</p>
                  <p className="mt-0.5 type-title-sm text-[var(--md-sys-color-on-surface)]">
                    {closeBehaviorLabels[closeBehavior]}
                  </p>
                  <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {closeBehavior === 'ask'
                      ? '창을 닫을 때마다 백그라운드 실행/종료/취소를 고릅니다.'
                      : closeBehavior === 'hide'
                        ? '창을 닫으면 트레이에 남고 메뉴에서 열기 또는 종료를 선택합니다.'
                        : '창을 닫으면 앱과 자동 문서 확인이 함께 종료됩니다.'}
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-3.5">
            <div className="mb-2.5 flex items-start gap-2.5">
              <Icon name="rocket_launch" size={20} className="mt-0.5 text-[var(--md-sys-color-primary)]" />
              <div>
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">시작프로그램</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  포터블 앱도 현재 실행 파일 경로를 OS 시작 항목에 등록할 수 있습니다.
                </p>
              </div>
            </div>
            {!startupSettingsAvailable ? (
              <EmptyState
                icon="desktop_windows"
                title="데스크톱 앱에서만 사용할 수 있습니다"
                description="브라우저 실행 환경에서는 시작프로그램을 등록할 수 없습니다."
                compact
              />
            ) : (
              <div className="space-y-2.5">
                <Switch
                  checked={startupSettings.enabled}
                  disabled={startupSettingsLoading || !startupSettings.supported}
                  onChange={(event) => onStartupSettingsChange(event.currentTarget.checked)}
                  label="로그인할 때 OfficeWhere 실행"
                  description={
                    startupSettings.supported
                      ? '앱 폴더나 실행 파일 위치를 옮기면 이 설정을 한 번 껐다가 다시 켜 주세요.'
                      : startupSettings.reason || '현재 환경에서는 시작프로그램 등록을 지원하지 않습니다.'
                  }
                />
                {startupSettings.requiresApproval && (
                  <p className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-secondary-container)]/45 px-3 py-2 type-body-sm text-[var(--md-sys-color-on-secondary-container)]">
                    macOS 시스템 설정에서 OfficeWhere 로그인을 허용해야 적용됩니다.
                  </p>
                )}
                {startupSettings.supported && startupSettings.reason && !startupSettings.requiresApproval && (
                  <p className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {startupSettings.reason}
                  </p>
                )}
                {startupSettings.executablePath && (
                  <p className="truncate rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2 font-mono text-[0.72rem] text-[var(--md-sys-color-on-surface-variant)]">
                    {startupSettings.executablePath}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-3.5">
            <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2.5">
              <div className="flex items-start gap-2.5">
                <Icon name="travel_explore" size={20} className="mt-0.5 text-[var(--md-sys-color-primary)]" />
                <div>
                  <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">빠른 검색 팔레트</p>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    앱 창을 열지 않고 화면 위쪽에 검색창을 띄웁니다.
                  </p>
                </div>
              </div>
              <Button
                variant="outlined"
                size="sm"
                leadingIcon="open_in_new"
                disabled={!quickSearchOpenAvailable}
                onClick={onOpenQuickSearch}
              >
                지금 열기
              </Button>
            </div>
            {!quickSearchSettingsAvailable ? (
              <EmptyState
                icon="keyboard"
                title="데스크톱 앱에서만 사용할 수 있습니다"
                description="브라우저 실행 환경에서는 전역 단축키와 팔레트 창을 제어할 수 없습니다."
                compact
              />
            ) : (
              <div className="space-y-2.5">
                <Switch
                  checked={quickSearchSettings.enabled}
                  disabled={quickSearchSettingsLoading || !quickSearchSettings.supported}
                  onChange={(event) => onQuickSearchSettingsChange({ enabled: event.currentTarget.checked })}
                  label="전역 단축키로 빠른 검색 열기"
                  description={
                    quickSearchSettings.registered
                      ? '어떤 앱을 쓰는 중이어도 단축키로 검색 팔레트를 엽니다.'
                      : quickSearchSettings.reason || '단축키 등록 상태를 확인하는 중입니다.'
                  }
                />

                <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
                  <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2.5">
                    <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">현재 단축키</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 type-title-sm text-[var(--md-sys-color-on-surface)]">
                      {shortcutParts(currentShortcutLabel).map((key) => (
                        <span key={key} className="kbd-token">
                          {key}
                        </span>
                      ))}
                      {!selectedPreset && (
                        <span className="ml-1 rounded-full bg-[var(--md-sys-color-primary-container)] px-2 py-0.5 type-label-sm text-[var(--md-sys-color-on-primary-container)]">
                          직접 지정
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg border px-3 py-2.5 lg:min-w-[10.5rem] ${
                      quickSearchSettings.registered
                        ? 'border-[var(--md-sys-color-success)] bg-[var(--md-sys-color-success-container)]/42 text-[var(--md-sys-color-on-success-container)]'
                        : 'border-[var(--md-sys-color-warning)] bg-[var(--md-sys-color-warning-container)]/48 text-[var(--md-sys-color-on-warning-container)]'
                    }`}
                  >
                    <p className="type-label-md opacity-80">등록 상태</p>
                    <p className="mt-0.5 inline-flex items-center gap-1.5 type-title-sm">
                      <Icon name={quickSearchSettings.registered ? 'check_circle' : 'info'} size={17} filled />
                      {quickSearchSettings.registered ? '사용 가능' : '확인 필요'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={quickSearchSettingsLoading}
                  onClick={startShortcutCapture}
                  onKeyDown={handleShortcutCaptureKeyDown}
                  className={`state-host relative w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    shortcutCaptureActive || !selectedPreset
                      ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/38'
                      : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                  }`}
                  aria-pressed={shortcutCaptureActive || !selectedPreset}
                  aria-label="빠른 검색 단축키 직접 지정"
                >
                  <span className="state-layer" />
                  <span className="relative flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 type-label-lg text-[var(--md-sys-color-on-surface)]">
                      <Icon name={shortcutCaptureActive ? 'keyboard' : 'edit'} size={17} />
                      {shortcutCaptureActive ? '키 조합 입력 중' : '직접 지정'}
                    </span>
                    <span className="type-label-sm text-[var(--md-sys-color-on-surface-variant)]">
                      Ctrl/Cmd · Alt · Shift + 문자/숫자/F키
                    </span>
                  </span>
                  <span className="relative mt-1 block type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {shortcutCaptureMessage || '누르는 즉시 저장하고 전역 단축키를 다시 등록합니다.'}
                  </span>
                </button>

                <div>
                  <p className="mb-1.5 type-label-sm text-[var(--md-sys-color-on-surface-variant)]">추천 조합</p>
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                    {QUICK_SEARCH_SHORTCUT_OPTIONS.map((option) => {
                      const selected = quickSearchSettings.accelerator === option.accelerator
                      const label = formatAcceleratorLabel(option.accelerator, preferCommandLabel)
                      return (
                        <button
                          key={option.accelerator}
                          type="button"
                          disabled={quickSearchSettingsLoading}
                          onClick={() => {
                            setShortcutCaptureActive(false)
                            setShortcutCaptureMessage('')
                            onQuickSearchSettingsChange({ accelerator: option.accelerator })
                          }}
                          className={`state-host relative rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                            selected
                              ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/42'
                              : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                          }`}
                          aria-pressed={selected}
                        >
                          <span className="state-layer" />
                          <span className="relative flex flex-wrap items-center gap-1.5">
                            {shortcutParts(label).map((key) => (
                              <span key={key} className="kbd-token">
                                {key}
                              </span>
                            ))}
                            {option.badge && (
                              <span className="rounded-full bg-[var(--md-sys-color-tertiary-container)] px-2 py-0.5 type-label-sm text-[var(--md-sys-color-on-tertiary-container)]">
                                {option.badge}
                              </span>
                            )}
                            {selected && (
                              <Icon
                                name="check_circle"
                                size={17}
                                filled
                                className="ml-auto text-[var(--md-sys-color-primary)]"
                              />
                            )}
                          </span>
                          <span className="relative mt-1.5 block type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                            {option.description}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </CardSection>
    </Card>
  )
}
