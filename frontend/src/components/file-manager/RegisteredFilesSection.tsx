import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { FileInfo } from '../../api/shared'
import {
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  FileTypeBadge,
  IconButton,
  Spinner,
  TextField,
} from '../../ui'

type RegisteredFilesSectionProps = {
  files: FileInfo[]
  fileTotal: number
  fileOffset: number
  pageSize: number
  fileQuery: string
  fileQueryDraft: string
  fileTypeCounts: Array<[string, number]>
  loading: boolean
  deletingFiles: boolean
  selectedFileIds: Set<number>
  selectedFiles: FileInfo[]
  selectedCount: number
  selectionMode: boolean
  selectionVisible: boolean
  visibleFileStart: number
  visibleFileEnd: number
  hasPreviousFilePage: boolean
  hasNextFilePage: boolean
  onToggleSelectionMode: () => void
  onOpenDeleteConfirm: (targets: FileInfo[]) => void
  onOpenClearAllFilesConfirm: () => void
  onRefresh: () => void
  onQueryDraftChange: (value: string) => void
  onSearch: () => void
  onClearSearch: () => void
  onRegisteredFilesKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  onFileFocus: (fileId: number) => void
  onFilePointerDown: (event: ReactPointerEvent<HTMLLIElement>, file: FileInfo, index: number) => void
  onFilePointerEnter: (index: number) => void
  onToggleRegisteredFileSelection: (file: FileInfo) => void
  onPreview: (file: FileInfo) => void
  onPage: (nextOffset: number) => void
}

export default function RegisteredFilesSection({
  files,
  fileTotal,
  fileOffset,
  pageSize,
  fileQuery,
  fileQueryDraft,
  fileTypeCounts,
  loading,
  deletingFiles,
  selectedFileIds,
  selectedFiles,
  selectedCount,
  selectionMode,
  selectionVisible,
  visibleFileStart,
  visibleFileEnd,
  hasPreviousFilePage,
  hasNextFilePage,
  onToggleSelectionMode,
  onOpenDeleteConfirm,
  onOpenClearAllFilesConfirm,
  onRefresh,
  onQueryDraftChange,
  onSearch,
  onClearSearch,
  onRegisteredFilesKeyDown,
  onFileFocus,
  onFilePointerDown,
  onFilePointerEnter,
  onToggleRegisteredFileSelection,
  onPreview,
  onPage,
}: RegisteredFilesSectionProps) {
  return (
    <Card variant="outlined" className="console-panel overflow-hidden">
      <header
        className="px-6 py-4 space-y-4 border-b border-[var(--md-sys-color-outline-variant)]"
        onKeyDown={onRegisteredFilesKeyDown}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="type-title-md text-[var(--md-sys-color-on-surface)]">
              등록된 파일 <span className="text-[var(--md-sys-color-on-surface-variant)]">({fileTotal})</span>
            </h3>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              등록한 문서는 최근 항목과 검색 결과 중심으로 보여줍니다. 등록 해제는 앱 목록과 검색 준비 데이터에서만 제거하며 원본 파일은 삭제하지 않습니다.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={selectionMode ? 'tonal' : 'outlined'}
              leadingIcon={selectionMode ? 'checklist' : 'delete_sweep'}
              disabled={deletingFiles}
              onClick={onToggleSelectionMode}
            >
              {selectionMode ? '선택 종료' : '선택해서 등록 해제'}
            </Button>
            {selectedCount > 0 && (
              <Button
                variant="danger"
                leadingIcon="delete"
                onClick={() => onOpenDeleteConfirm(selectedFiles)}
                disabled={deletingFiles}
              >
                선택 등록 해제 {selectedCount}개
              </Button>
            )}
            <Button
              variant="danger"
              leadingIcon="delete_forever"
              onClick={onOpenClearAllFilesConfirm}
              disabled={fileTotal === 0 || loading || deletingFiles}
            >
              전체 등록 해제
            </Button>
            <IconButton
              icon="refresh"
              label="새로고침"
              variant="tonal"
              onClick={onRefresh}
              disabled={loading || deletingFiles}
            />
          </div>
        </div>
        <div className="flex gap-2 items-start flex-wrap md:flex-nowrap">
          <div className="flex-1 min-w-[240px]">
            <TextField
              leadingIcon="search"
              placeholder="파일명 또는 경로로 검색"
              value={fileQueryDraft}
              onChange={(event) => onQueryDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearch()
              }}
            />
          </div>
          <Button variant="filled" leadingIcon="search" onClick={onSearch} disabled={loading}>
            검색
          </Button>
          {fileQuery && (
            <Button variant="text" leadingIcon="close" onClick={onClearSearch} disabled={loading}>
              검색 해제
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Chip
            label={
              fileTotal === 0
                ? '표시 0개'
                : `표시 ${visibleFileStart}-${visibleFileEnd} / 전체 ${fileTotal}`
            }
            tone="primary"
            icon="view_list"
            as="span"
          />
          {fileQuery && <Chip label={`검색어 · ${fileQuery}`} tone="secondary" icon="search" as="span" />}
          {selectedCount > 0 && (
            <Chip label={`선택 ${selectedCount}개 · Delete로 등록 해제`} tone="warning" icon="keyboard" as="span" />
          )}
          {fileTypeCounts.map(([fileType, count]) => (
            <span
              key={fileType}
              className="inline-flex items-center h-7 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 type-label-md text-[var(--md-sys-color-on-surface-variant)]"
            >
              {fileType} {count}
            </span>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="px-6 py-10 flex items-center justify-center gap-2 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
          <Spinner size={18} /> 불러오는 중…
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon="library_add"
          title="아직 등록된 파일이 없습니다"
          description="파일 경로를 입력하거나 '파일 찾기'로 Excel / Word / PPT 파일을 추가해 보세요."
          compact
        />
      ) : (
        <ul
          className="divide-y divide-[var(--md-sys-color-outline-variant)]"
          onKeyDown={onRegisteredFilesKeyDown}
        >
          {files.map((file, index) => {
            const selected = selectedFileIds.has(file.id)
            const missing = file.availability_status === 'missing'
            return (
              <li
                key={file.id}
                tabIndex={0}
                onFocus={() => onFileFocus(file.id)}
                onPointerDown={(event) => onFilePointerDown(event, file, index)}
                onPointerEnter={() => onFilePointerEnter(index)}
                className={`px-6 py-4 flex items-start justify-between gap-4 transition-colors outline-none ${
                  selected
                    ? 'bg-[var(--md-sys-color-primary-container)]/35'
                    : 'hover:bg-[var(--md-sys-color-surface-container-low)]'
                } ${selectionMode ? 'select-none cursor-crosshair' : ''} ${
                  missing ? 'bg-[var(--md-sys-color-error-container)]/15' : ''
                }`}
              >
                {selectionVisible && (
                  <div className="pt-1">
                    <Checkbox
                      checked={selected}
                      aria-label={`${file.name} 선택`}
                      onChange={() => onToggleRegisteredFileSelection(file)}
                    />
                  </div>
                )}
                {selectionMode ? (
                  <div
                    className="flex-1 min-w-0 text-left group"
                    onClick={() => onToggleRegisteredFileSelection(file)}
                  >
                    <RegisteredFileSummary file={file} />
                  </div>
                ) : missing ? (
                  <div className="flex-1 min-w-0 text-left group cursor-not-allowed">
                    <RegisteredFileSummary file={file} />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPreview(file)}
                    className="flex-1 min-w-0 text-left group"
                  >
                    <RegisteredFileSummary file={file} />
                  </button>
                )}
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    {file.created_at ? file.created_at.replace('T', ' ').slice(0, 19) : '-'}
                  </p>
                  <IconButton
                    icon="delete"
                    label={`${file.name} 등록 해제`}
                    variant="standard"
                    size="sm"
                    onClick={() => onOpenDeleteConfirm([file])}
                    disabled={deletingFiles}
                    className="text-[var(--md-sys-color-error)]"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {fileTotal > pageSize && (
        <footer className="px-6 py-4 flex items-center justify-between gap-3 border-t border-[var(--md-sys-color-outline-variant)] flex-wrap">
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            {visibleFileStart}-{visibleFileEnd} / {fileTotal}개
          </p>
          <div className="flex gap-2">
            <Button
              variant="outlined"
              leadingIcon="chevron_left"
              onClick={() => onPage(fileOffset - pageSize)}
              disabled={!hasPreviousFilePage || loading}
            >
              이전
            </Button>
            <Button
              variant="outlined"
              trailingIcon="chevron_right"
              onClick={() => onPage(fileOffset + pageSize)}
              disabled={!hasNextFilePage || loading}
            >
              다음
            </Button>
          </div>
        </footer>
      )}
    </Card>
  )
}

function RegisteredFileSummary({ file }: { file: FileInfo }) {
  const missing = file.availability_status === 'missing'
  const missingLabel = missingStatusLabel(file.missing_since)
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="type-title-sm text-[var(--md-sys-color-primary)] group-hover:underline">
          {file.name}
        </span>
        <FileTypeBadge fileType={file.file_type} />
        {missing && (
          <span className="inline-flex items-center rounded-full border border-[var(--md-sys-color-error)]/30 bg-[var(--md-sys-color-error-container)] px-2 py-0.5 type-label-sm text-[var(--md-sys-color-on-error-container)]">
            원본 없음{missingLabel ? ` · ${missingLabel}` : ''}
          </span>
        )}
      </div>
      <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)] mt-1 break-all">
        {file.path}
      </p>
      {missing && (
        <p className="type-body-sm text-[var(--md-sys-color-error)] mt-1">
          문서 새로고침에서 원본 경로를 찾지 못했습니다. 다시 발견되면 자동으로 복구되고, 7일 이상 계속 없으면 앱 목록과 검색 데이터에서만 정리됩니다.
        </p>
      )}
    </>
  )
}

function missingStatusLabel(missingSince?: string | null) {
  if (!missingSince) return ''
  const since = new Date(missingSince)
  if (Number.isNaN(since.getTime())) return ''
  const elapsedDays = Math.max(0, Math.floor((Date.now() - since.getTime()) / 86_400_000))
  const remainingDays = Math.max(0, 7 - elapsedDays)
  return remainingDays > 0 ? `자동 정리까지 약 ${remainingDays}일` : '다음 새로고침에서 자동 정리'
}
