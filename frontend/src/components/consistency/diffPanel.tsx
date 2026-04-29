import { useEffect, useState } from 'react'

import { Button } from '../../ui'

export function DiffPanel({
  title,
  content,
  tone,
  previewMaxChars = 0,
}: {
  title: string
  content: string
  tone: 'danger' | 'success'
  previewMaxChars?: number
}) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(false)
  }, [content])

  const normalizedContent = content || '(내용 없음)'
  const shouldPreview = previewMaxChars > 0 && normalizedContent.length > previewMaxChars
  const visibleContent = shouldPreview && !expanded
    ? `${normalizedContent.slice(0, previewMaxChars).trimEnd()}…`
    : normalizedContent

  return (
    <div className={`diff-panel diff-panel-${tone}`}>
      <p className="diff-panel-label type-label-md">
        {title}
      </p>
      <p className="type-body-md text-[var(--md-sys-color-on-surface)] mt-2 whitespace-pre-wrap break-words">
        {visibleContent}
      </p>
      {shouldPreview && (
        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
          {!expanded && (
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              내용이 길어 일부만 표시합니다. 파일에서 직접 확인해 주세요.
            </p>
          )}
          <Button variant="text" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? '접기' : '전체 보기'}
          </Button>
        </div>
      )}
    </div>
  )
}
