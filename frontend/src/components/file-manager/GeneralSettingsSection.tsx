import type { CloseBehavior } from '../../api/client'
import {
  APP_TEXT_SIZE_DESCRIPTIONS,
  APP_TEXT_SIZE_LABELS,
  APP_TEXT_SIZE_ORDER,
  APP_THEME_MODE_DESCRIPTIONS,
  APP_THEME_MODE_LABELS,
  APP_THEME_MODE_ORDER,
} from '../../contexts/DisplaySettingsContext'
import type { AppTextSize, AppThemeMode, ResolvedAppTheme } from '../../contexts/DisplaySettingsContext'
import { Card, CardSection, EmptyState, Icon, SelectField } from '../../ui'

type GeneralSettingsSectionProps = {
  textSize: AppTextSize
  themeMode: AppThemeMode
  resolvedTheme: ResolvedAppTheme
  closeBehavior: CloseBehavior
  closeBehaviorLabels: Record<CloseBehavior, string>
  closeBehaviorAvailable: boolean
  closeBehaviorLoading: boolean
  onTextSizeChange: (size: AppTextSize) => void
  onThemeModeChange: (mode: AppThemeMode) => void
  onCloseBehaviorChange: (behavior: CloseBehavior) => void
}

export default function GeneralSettingsSection({
  textSize,
  themeMode,
  resolvedTheme,
  closeBehavior,
  closeBehaviorLabels,
  closeBehaviorAvailable,
  closeBehaviorLoading,
  onTextSizeChange,
  onThemeModeChange,
  onCloseBehaviorChange,
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

          <section className="rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/82 p-4">
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
          </section>
        </div>
      </CardSection>
    </Card>
  )
}
