import { CompareMetadata, CompareWarning } from '../../api/client'
import { Badge, Card, Icon } from '../../ui'

const COMPARE_WARNING_LABELS: Record<CompareWarning['type'], string> = {
  truncated: '일부만 표시',
  high_change_ratio: '변경 많음',
  source_may_be_newer: '문서 확인 후 수정됨',
  simplified_comparison: '간소 비교',
  artifact_missing: '비교 결과 준비 필요',
  artifact_version_mismatch: '비교 결과 새로고침 필요',
  artifact_rebuilt_or_refresh_needed: '새로고침 권장',
}

export function CompareMetadataWarnings({ metadata }: { metadata: CompareMetadata }) {
  const statErrorWarning =
    metadata.sourceStatErrorCount > 0
      ? {
          type: 'source_may_be_newer' as const,
          severity: 'info' as const,
          message:
            '일부 원본 파일의 수정 시간을 확인하지 못했습니다. 비교 결과는 마지막 문서 확인 시점을 기준으로 표시됩니다.',
          fileIds: [],
          details: {},
        }
      : null
  const warnings = statErrorWarning ? [...metadata.warnings, statErrorWarning] : metadata.warnings

  if (warnings.length === 0) return null

  return (
    <Card variant="outlined" className="overflow-hidden border-[var(--md-sys-color-warning)]/60">
      <header className="flex items-start gap-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-warning-container)]/45 px-4 py-3 sm:px-5">
        <Icon name="info" size={20} className="mt-0.5 text-[var(--md-sys-color-on-warning-container)]" />
        <div>
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">비교 결과 참고 사항</p>
          <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            실제 변경 내용과 별도로, 비교 방식이나 문서 확인 상태에 대한 안내입니다.
          </p>
        </div>
      </header>
      <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
        {warnings.map((warning, index) => (
          <li key={`${warning.type}-${index}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            <Badge tone={warning.severity === 'info' ? 'neutral' : 'warning'}>
              {COMPARE_WARNING_LABELS[warning.type]}
            </Badge>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface)]">{warning.message}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
