import { NormalizedPreview } from '../api/client'
import { Chip } from '../ui'

interface PreviewPanelProps {
  preview: NormalizedPreview
}

export default function PreviewPanel({ preview }: PreviewPanelProps) {
  return (
    <div className="space-y-4">
      {preview.summary.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {preview.summary.map((item) => (
            <Chip key={item} label={item} as="span" tone="neutral" />
          ))}
        </div>
      )}

      {preview.mode === 'excel' || preview.table.columns.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]">
          <table className="min-w-full text-xs">
            <thead className="bg-[var(--md-sys-color-surface-container-low)]">
              <tr>
                {preview.table.columns.map((column) => (
                  <th
                    key={column}
                    className="px-3 py-2 text-left type-label-md text-[var(--md-sys-color-on-surface-variant)] whitespace-nowrap border-b border-[var(--md-sys-color-outline-variant)]"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)]">
              {preview.table.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(preview.table.columns.length, 1)}
                    className="px-3 py-6 text-center type-body-sm text-[var(--md-sys-color-on-surface-variant)]"
                  >
                    표시할 샘플 행이 없습니다.
                  </td>
                </tr>
              ) : (
                preview.table.rows.map((row, rowIndex) => (
                  <tr key={`${row.join('|')}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${cell}-${cellIndex}`}
                        className="px-3 py-2 text-[var(--md-sys-color-on-surface)] whitespace-nowrap"
                        title={cell}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {preview.mode === 'word' && preview.blocks.length > 0 && (
        <div className="space-y-2">
          {preview.blocks.map((block) => (
            <div
              key={block.id}
              className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3"
            >
              <div className="flex items-center gap-2 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                <Chip label={block.blockType} tone="neutral" as="span" />
                <span>{block.location}</span>
              </div>
              <p className="type-body-md text-[var(--md-sys-color-on-surface)] mt-2 whitespace-pre-wrap break-words">
                {block.text || '(빈 블록)'}
              </p>
            </div>
          ))}
        </div>
      )}

      {preview.mode === 'ppt' && preview.slides.length > 0 && (
        <div className="space-y-3">
          {preview.slides.map((slide) => (
            <div
              key={slide.id}
              className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Chip label={`Slide ${slide.slideNumber}`} tone="primary" as="span" />
                <span className="type-title-sm text-[var(--md-sys-color-on-surface)]">
                  {slide.title}
                </span>
              </div>
              {slide.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {slide.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2"
                    >
                      <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                        {item.itemType} · {item.location}
                      </p>
                      <p className="type-body-md text-[var(--md-sys-color-on-surface)] mt-1 whitespace-pre-wrap break-words">
                        {item.afterText || item.beforeText || '(텍스트 없음)'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-2">
                  표시할 슬라이드 항목이 없습니다.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
