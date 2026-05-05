import { WordDiffCard } from '../../api/client'
import { Badge, Card, StatCard } from '../../ui'
import { DiffPanel } from './diffPanel'

const DIFF_TYPE_KO: Record<string, string> = {
  insert: '추가',
  delete: '삭제',
  replace: '수정',
}

export function WordCheckResult({
  diffs,
  compact = false,
}: {
  diffs: WordDiffCard[]
  compact?: boolean
}) {
  const insertCount = diffs.filter((diff) => diff.type === 'insert').length
  const deleteCount = diffs.filter((diff) => diff.type === 'delete').length
  const replaceCount = diffs.filter((diff) => diff.type === 'replace').length

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="전체 변경" value={diffs.length} icon="edit_note" />
          <StatCard label="추가" value={insertCount} icon="add_circle" tone="success" />
          <StatCard label="삭제" value={deleteCount} icon="do_not_disturb_on" tone="danger" />
          <StatCard label="수정" value={replaceCount} icon="change_circle" tone="warning" />
        </div>
      )}

      <Card variant="outlined" className="overflow-hidden">
        <header className="px-6 py-3 bg-[var(--md-sys-color-surface-container-low)] border-b border-[var(--md-sys-color-outline-variant)]">
          <p className="type-title-sm text-[var(--md-sys-color-on-surface)]">Word 변경 내용</p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
            쪽 번호는 문서에 저장된 페이지 나눔 정보를 기준으로 표시합니다.
          </p>
        </header>
        {diffs.length === 0 ? (
          <p className="px-6 py-8 type-body-sm text-[var(--md-sys-color-on-surface-variant)] text-center">
            문서에서 달라진 내용이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
            {diffs.map((diff) => (
              <li key={diff.id} className="px-6 py-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    tone={
                      diff.type === 'insert'
                        ? 'success'
                        : diff.type === 'delete'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {DIFF_TYPE_KO[diff.type]}
                  </Badge>
                  <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                    {diff.pageLabel}
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <DiffPanel title="기존 내용" content={diff.beforeText} tone="danger" />
                  <DiffPanel title="변경 후 내용" content={diff.afterText} tone="success" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
