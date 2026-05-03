import type { CloseBehavior } from '../../api/client'
import {
  APP_TEXT_SIZE_DESCRIPTIONS,
  APP_TEXT_SIZE_LABELS,
  APP_TEXT_SIZE_ORDER,
} from '../../contexts/DisplaySettingsContext'
import type { AppTextSize } from '../../contexts/DisplaySettingsContext'
import { Card, CardSection, EmptyState, Icon, SelectField } from '../../ui'

type GeneralSettingsSectionProps = {
  textSize: AppTextSize
  closeBehavior: CloseBehavior
  closeBehaviorLabels: Record<CloseBehavior, string>
  closeBehaviorAvailable: boolean
  closeBehaviorLoading: boolean
  onTextSizeChange: (size: AppTextSize) => void
  onCloseBehaviorChange: (behavior: CloseBehavior) => void
}

export default function GeneralSettingsSection({
  textSize,
  closeBehavior,
  closeBehaviorLabels,
  closeBehaviorAvailable,
  closeBehaviorLoading,
  onTextSizeChange,
  onCloseBehaviorChange,
}: GeneralSettingsSectionProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card variant="outlined">
        <CardSection
          title="화면 표시"
          description="앱 전체 글자 크기"
          className="p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            {APP_TEXT_SIZE_ORDER.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onTextSizeChange(size)}
                className={`state-host relative text-left rounded-md border px-2.5 py-2 transition-colors ${
                  textSize === size
                    ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/40'
                    : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] hover:bg-[var(--md-sys-color-surface-container-low)]'
                }`}
              >
                <span className="state-layer" />
                <span className="relative flex items-center justify-between gap-2">
                  <span className="type-label-md text-[var(--md-sys-color-on-surface)]">
                    {APP_TEXT_SIZE_LABELS[size]}
                  </span>
                  {textSize === size && <Icon name="check_circle" size={18} filled className="text-[var(--md-sys-color-primary)]" />}
                </span>
                <span className="relative mt-1 block text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  {APP_TEXT_SIZE_DESCRIPTIONS[size]}
                </span>
              </button>
            ))}
          </div>
        </CardSection>
      </Card>

      <Card variant="outlined">
        <CardSection
          title="창 닫기 동작"
          description="X 버튼을 눌렀을 때의 동작"
          className="p-3"
        >
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
              <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-2.5 flex items-start gap-2.5">
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
        </CardSection>
      </Card>
    </div>
  )
}
