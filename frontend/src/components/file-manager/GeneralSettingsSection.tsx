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
    label: 'Ctrl/⌘ + Alt/⌥ + F',
    badge: '추천',
    description: 'Space 계열 OS/IME 충돌을 피한 기본 단축키입니다.',
  },
  {
    accelerator: 'CommandOrControl+Alt+Space',
    label: 'Ctrl/⌘ + Alt/⌥ + Space',
    description: 'Spotlight 느낌을 유지하고 싶을 때 쓰는 대안입니다.',
  },
  {
    accelerator: 'CommandOrControl+Shift+F',
    label: 'Ctrl/⌘ + Shift + F',
    description: 'Alt 조합이 이미 다른 앱과 겹칠 때 선택합니다.',
  },
]

function shortcutParts(label: string) {
  if (label.includes(' + ')) return label.split(' + ').filter(Boolean)
  return label
    .replace(/([⌘⇧⌥])/g, ' $1 ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
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
  return (
    <Card variant="elevated" className="console-panel overflow-hidden">
      <CardSection
        title="표시 설정과 앱 동작"
        description="문서를 오래 읽어도 부담이 적도록 화면 모드와 글자 크기를 정하고, 데스크톱 창 닫기 방식을 관리합니다."
        className="p-5 md:p-6"
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <section className="space-y-4">
            <div className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">테마</p>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    현재 적용: {resolvedTheme === 'dark' ? '다크' : '라이트'}
                  </p>
                </div>
                <Icon
                  name={resolvedTheme === 'dark' ? 'dark_mode' : 'light_mode'}
                  size={22}
                  className="text-[var(--md-sys-color-primary)]"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {APP_THEME_MODE_ORDER.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onThemeModeChange(mode)}
                    className={`state-host relative rounded-lg border p-3 text-left transition-colors ${
                      themeMode === mode
                        ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/45 text-[var(--md-sys-color-on-primary-container)]'
                        : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                    }`}
                    aria-pressed={themeMode === mode}
                  >
                    <span className="state-layer" />
                    <span className="relative flex items-center justify-between gap-2">
                      <span className="type-label-lg">{APP_THEME_MODE_LABELS[mode]}</span>
                      {themeMode === mode && <Icon name="check_circle" size={18} filled />}
                    </span>
                    <span className="relative mt-1 block type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                      {APP_THEME_MODE_DESCRIPTIONS[mode]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-4">
              <div className="mb-3">
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">글자 크기</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  Ctrl/⌘ + 마우스휠 또는 Ctrl/⌘ +/- 로도 조정할 수 있습니다.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {APP_TEXT_SIZE_ORDER.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onTextSizeChange(size)}
                    className={`state-host relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
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
                        <Icon name="check_circle" size={18} filled className="text-[var(--md-sys-color-primary)]" />
                      )}
                    </span>
                    <span className="relative mt-1 block text-xs text-[var(--md-sys-color-on-surface-variant)]">
                      {APP_TEXT_SIZE_DESCRIPTIONS[size]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-4">
              <div className="mb-3">
                <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">창 닫기 동작</p>
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  X 버튼을 눌렀을 때 OfficeWhere가 백그라운드에 남을지 정합니다.
                </p>
              </div>
              {!closeBehaviorAvailable ? (
                <EmptyState
                  icon="desktop_windows"
                  title="데스크톱 앱에서만 사용할 수 있습니다"
                  description="현재 실행 환경에서는 트레이와 창 닫기 동작을 제어할 수 없습니다."
                  compact
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 items-start">
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
                  <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3 flex items-start gap-2.5">
                    <Icon
                      name={closeBehavior === 'quit' ? 'power_settings_new' : 'move_to_inbox'}
                      size={20}
                      className="mt-0.5 text-[var(--md-sys-color-primary)]"
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                        현재 설정 · {closeBehaviorLabels[closeBehavior]}
                      </p>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                        {closeBehavior === 'ask'
                          ? '창을 닫을 때마다 백그라운드 실행/종료/취소를 고를 수 있습니다.'
                          : closeBehavior === 'hide'
                            ? '창을 닫으면 트레이에 남고, 트레이 메뉴에서 열기 또는 종료를 선택할 수 있습니다.'
                            : '창을 닫으면 앱과 자동 문서 확인이 함께 종료됩니다.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-4">
              <div className="mb-3 flex items-start gap-2.5">
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
                <div className="space-y-3">
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
            </div>

            <div className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-4">
              <div className="mb-3 flex items-start gap-2.5">
                <Icon name="travel_explore" size={20} className="mt-0.5 text-[var(--md-sys-color-primary)]" />
                <div>
                  <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">빠른 검색 팔레트</p>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    앱 창을 열지 않고 화면 위쪽에 Spotlight형 검색창을 띄웁니다.
                  </p>
                </div>
              </div>
              {!quickSearchSettingsAvailable ? (
                <EmptyState
                  icon="keyboard"
                  title="데스크톱 앱에서만 사용할 수 있습니다"
                  description="브라우저 실행 환경에서는 전역 단축키와 팔레트 창을 제어할 수 없습니다."
                  compact
                />
              ) : (
                <div className="space-y-3">
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
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3">
                      <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">현재 단축키</p>
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 type-title-sm text-[var(--md-sys-color-on-surface)]">
                        {shortcutParts(quickSearchSettings.displayShortcut).map((key) => (
                          <span key={key} className="kbd-token">
                            {key}
                          </span>
                        ))}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg border p-3 ${
                        quickSearchSettings.registered
                          ? 'border-[var(--md-sys-color-success)] bg-[var(--md-sys-color-success-container)]/42 text-[var(--md-sys-color-on-success-container)]'
                          : 'border-[var(--md-sys-color-warning)] bg-[var(--md-sys-color-warning-container)]/48 text-[var(--md-sys-color-on-warning-container)]'
                      }`}
                    >
                      <p className="type-label-md opacity-80">등록 상태</p>
                      <p className="mt-1 inline-flex items-center gap-1.5 type-title-sm">
                        <Icon name={quickSearchSettings.registered ? 'check_circle' : 'info'} size={18} filled />
                        {quickSearchSettings.registered ? '사용 가능' : '확인 필요'}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="type-label-md text-[var(--md-sys-color-on-surface)]">단축키 선택</p>
                        <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                          등록 실패가 보이면 다른 조합으로 바꾸면 즉시 재등록합니다.
                        </p>
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
                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                      {QUICK_SEARCH_SHORTCUT_OPTIONS.map((option) => {
                        const selected = quickSearchSettings.accelerator === option.accelerator
                        return (
                          <button
                            key={option.accelerator}
                            type="button"
                            disabled={quickSearchSettingsLoading}
                            onClick={() => onQuickSearchSettingsChange({ accelerator: option.accelerator })}
                            className={`state-host relative rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                              selected
                                ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/42'
                                : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                            }`}
                            aria-pressed={selected}
                          >
                            <span className="state-layer" />
                            <span className="relative flex flex-wrap items-center gap-1.5">
                              {shortcutParts(option.label).map((key) => (
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
                            <span className="relative mt-2 block type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                              {option.description}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <Switch
                    checked={quickSearchSettings.showRecent}
                    disabled={quickSearchSettingsLoading}
                    onChange={(event) => onQuickSearchSettingsChange({ showRecent: event.currentTarget.checked })}
                    label="팔레트에 최근 검색어 표시"
                    description="검색창이 비어 있을 때 최근 검색어를 칩으로 보여줍니다."
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      </CardSection>
    </Card>
  )
}
