import type { AppDataCandidate, ClearAppDataResult } from '../../api/client'
import { Badge, Button, Card, CardSection, Checkbox, EmptyState } from '../../ui'
import { formatBytes } from './format'

type AppDataManagementSectionProps = {
  appDataAvailable: boolean
  appDataPaths: AppDataCandidate[]
  appDataLoading: boolean
  selectedAppDataIds: string[]
  appDataAdvancedOpen: boolean
  clearAppDataResult: ClearAppDataResult | null
  safeResetIds: string[]
  safeResetSize: number
  fullResetIds: string[]
  fullResetSize: number
  onRefreshPaths: () => void
  onOpenPreset: (candidateIds: string[]) => void
  onToggleCandidate: (id: string) => void
  onToggleAdvanced: (open: boolean) => void
  onOpenSelectedDelete: () => void
}

export default function AppDataManagementSection({
  appDataAvailable,
  appDataPaths,
  appDataLoading,
  selectedAppDataIds,
  appDataAdvancedOpen,
  clearAppDataResult,
  safeResetIds,
  safeResetSize,
  fullResetIds,
  fullResetSize,
  onRefreshPaths,
  onOpenPreset,
  onToggleCandidate,
  onToggleAdvanced,
  onOpenSelectedDelete,
}: AppDataManagementSectionProps) {
  return (
    <Card variant="outlined">
      <CardSection
        title="앱 데이터 관리"
        description="문제 해결이 필요할 때만 검색 준비 데이터와 앱 설정을 초기화합니다. 원본 문서는 삭제하지 않습니다."
        className="p-3"
        trailing={
          appDataAvailable ? (
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="tonal"
                size="sm"
                leadingIcon="refresh"
                onClick={onRefreshPaths}
                loading={appDataLoading}
              >
                경로 새로고침
              </Button>
            </div>
          ) : null
        }
      >
        {!appDataAvailable ? (
          <EmptyState
            icon="desktop_windows"
            title="데스크톱 앱에서만 사용할 수 있습니다"
            description="현재 실행 환경에서는 앱 데이터 경로를 안전하게 확인할 수 없어 삭제 기능을 비활성화합니다."
            compact
          />
        ) : appDataPaths.length === 0 ? (
          <EmptyState
            icon="folder_managed"
            title="앱 데이터 경로를 불러오세요"
            description="경로 새로고침을 누르면 초기화 가능한 앱 데이터를 확인합니다."
            compact
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                      검색/앱 설정 초기화
                    </p>
                    <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                      검색 준비 데이터, 화면 설정, 임시 데이터를 다음 실행 때 새로 만듭니다.
                    </p>
                  </div>
                  <Badge tone={safeResetIds.length > 0 ? 'success' : 'neutral'}>
                    {safeResetIds.length > 0 ? formatBytes(safeResetSize) : '삭제할 항목 없음'}
                  </Badge>
                </div>
                <Button
                  variant="filled"
                  size="sm"
                  leadingIcon="restart_alt"
                  onClick={() => onOpenPreset(safeResetIds)}
                  disabled={safeResetIds.length === 0 || appDataLoading}
                >
                  초기화 후 앱 종료
                </Button>
              </div>

              <div className="rounded-md border border-[var(--md-sys-color-error)]/50 bg-[var(--md-sys-color-error-container)]/20 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                      문제 해결용 전체 초기화
                    </p>
                    <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                      앱 프로필 전체를 다음 실행 때 새로 만듭니다.
                    </p>
                  </div>
                  <Badge tone={fullResetIds.length > 0 ? 'warning' : 'neutral'}>
                    {fullResetIds.length > 0 ? formatBytes(fullResetSize) : '삭제할 항목 없음'}
                  </Badge>
                </div>
                <Button
                  variant="outlined"
                  size="sm"
                  leadingIcon="warning"
                  className="!text-[var(--md-sys-color-error)]"
                  onClick={() => onOpenPreset(fullResetIds)}
                  disabled={fullResetIds.length === 0 || appDataLoading}
                >
                  전체 초기화
                </Button>
              </div>
            </div>

            <details
              className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3"
              open={appDataAdvancedOpen}
              onToggle={(event) => onToggleAdvanced(event.currentTarget.open)}
            >
              <summary className="type-label-lg text-[var(--md-sys-color-primary)] cursor-pointer">
                고급 보기: 삭제 대상 직접 선택
              </summary>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-2">
                문제 해결을 위해 세부 항목을 직접 고를 때만 사용하세요.
              </p>
              <div className="mt-3 space-y-2">
                {appDataPaths.map((candidate) => (
                  <div
                    key={candidate.id}
                    className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2.5 flex items-start gap-3"
                  >
                    <Checkbox
                      checked={selectedAppDataIds.includes(candidate.id)}
                      onChange={() => onToggleCandidate(candidate.id)}
                      disabled={!candidate.exists || appDataLoading}
                      label=""
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">{candidate.label}</p>
                        <Badge tone={candidate.exists ? 'success' : 'neutral'}>
                          {candidate.exists ? formatBytes(candidate.sizeBytes) : '없음'}
                        </Badge>
                        {candidate.dangerous && <Badge tone="warning">전체 초기화</Badge>}
                      </div>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                        {candidate.description}
                      </p>
                      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] break-all">
                        {candidate.path}
                      </p>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outlined"
                  leadingIcon="delete_sweep"
                  className="!text-[var(--md-sys-color-error)]"
                  onClick={onOpenSelectedDelete}
                  disabled={selectedAppDataIds.length === 0 || appDataLoading}
                >
                  선택한 항목 삭제
                </Button>
              </div>
            </details>
          </div>
        )}
        {clearAppDataResult && (
          <div className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-4 space-y-2">
            <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">최근 삭제 결과</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              문서 서비스 종료 {clearAppDataResult.backendStopped ? '확인' : '타임아웃'} · 삭제 {clearAppDataResult.deleted.length}개 · 실패 {clearAppDataResult.failed.length}개
              {clearAppDataResult.restartScheduled
                ? ' · 앱 재시작 예약'
                : clearAppDataResult.exitScheduled
                  ? ' · 앱 종료 예약'
                  : ''}
            </p>
            {clearAppDataResult.failed.map((item) => (
              <p key={`${item.id}-${item.path}`} className="type-body-sm text-[var(--md-sys-color-error)] break-all">
                {item.path}: {item.error}
              </p>
            ))}
          </div>
        )}
      </CardSection>
    </Card>
  )
}
