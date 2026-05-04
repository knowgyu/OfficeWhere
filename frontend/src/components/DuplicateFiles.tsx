import { useEffect, useMemo, useState } from 'react'

import { api, type DuplicateFileGroup, type DuplicateFileItem } from '../api/client'
import {
  Badge,
  Button,
  Card,
  CardSection,
  Chip,
  EmptyState,
  FileTypeBadge,
  Icon,
  Spinner,
  TextField,
  useSnackbar,
} from '../ui'

const DUPLICATE_PAGE_SIZE = 30

function formatContentSize(chars: number) {
  if (!Number.isFinite(chars) || chars <= 0) return '내용 크기 미상'
  if (chars >= 10_000) return `${Math.round(chars / 1000).toLocaleString('ko-KR')}천 글자`
  return `${chars.toLocaleString('ko-KR')}자`
}

function formatModifiedTime(value?: number | null) {
  if (!value) return '수정일 미상'
  return new Date(value * 1000).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function parentPath(path: string) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash >= 0 ? path.slice(0, slash) : path
}

function signatureLabel(signature: string) {
  return signature ? signature.slice(0, 10).toUpperCase() : '내용 서명 없음'
}

function displayGroupTitle(group: DuplicateFileGroup) {
  const names = Array.from(new Set(group.files.map((file) => file.name))).slice(0, 2)
  if (names.length === 0) return '같은 내용 문서'
  return `${names.join(' · ')}${group.distinct_name_count > names.length ? ` 외 ${group.distinct_name_count - names.length}개 이름` : ''}`
}

function newestFileId(group: DuplicateFileGroup) {
  const newest = group.files.reduce<DuplicateFileItem | null>((current, file) => {
    if (!current) return file
    return (file.file_mtime ?? 0) > (current.file_mtime ?? 0) ? file : current
  }, null)
  return newest?.id ?? null
}

export default function DuplicateFiles({ libraryDataRevision = 0 }: { libraryDataRevision?: number }) {
  const snackbar = useSnackbar()
  const [groups, setGroups] = useState<DuplicateFileGroup[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  const fetchDuplicates = async (nextOffset = offset) => {
    setLoading(true)
    try {
      const response = await api.files.duplicates({
        limit: DUPLICATE_PAGE_SIZE,
        offset: nextOffset,
      })
      setGroups(response.data.groups)
      setTotal(response.data.total)
      setOffset(response.data.offset)
    } catch {
      snackbar.error('같은 내용 문서 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchDuplicates(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryDataRevision])

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR')
    if (!normalizedQuery) return groups
    return groups.filter((group) =>
      group.files.some((file) =>
        `${file.name} ${file.path}`.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
      ),
    )
  }, [groups, query])
  const fileCount = useMemo(
    () => filteredGroups.reduce((totalFiles, group) => totalFiles + group.files.length, 0),
    [filteredGroups],
  )
  const hasPrevious = offset > 0
  const hasNext = offset + DUPLICATE_PAGE_SIZE < total
  const visibleStart = total === 0 ? 0 : offset + 1
  const visibleEnd = Math.min(offset + groups.length, total)

  const openFile = async (file: DuplicateFileItem) => {
    try {
      await api.files.open(file.id)
    } catch {
      snackbar.error(`파일을 열 수 없습니다: ${file.name}`)
    }
  }

  const showInFolder = async (file: DuplicateFileItem) => {
    try {
      await api.files.showInFolder(file.id, file.path)
    } catch {
      snackbar.error(`폴더를 열 수 없습니다: ${file.name}`)
    }
  }

  return (
    <div className="space-y-6">
      <Card variant="elevated">
        <CardSection
          title="같은 내용 문서"
          description="파일명은 다르지만 검색용으로 읽은 본문이 같은 문서를 묶어서 보여줍니다. 원본 문서는 여기서 삭제·이동하지 않습니다."
          trailing={
            <Button
              variant="outlined"
              size="sm"
              leadingIcon="refresh"
              onClick={() => void fetchDuplicates(0)}
              loading={loading}
            >
              새로고침
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="surface-summary rounded-lg p-4">
              <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">같은 내용 묶음</p>
              <p className="mt-1 type-title-lg text-[var(--md-sys-color-on-surface)]">{total.toLocaleString('ko-KR')}개</p>
            </div>
            <div className="surface-summary rounded-lg p-4">
              <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">표시 중인 파일</p>
              <p className="mt-1 type-title-lg text-[var(--md-sys-color-on-surface)]">{fileCount.toLocaleString('ko-KR')}개</p>
            </div>
            <div className="surface-summary rounded-lg p-4">
              <p className="type-label-md text-[var(--md-sys-color-on-surface-variant)]">동작 방식</p>
              <p className="mt-1 type-body-sm text-[var(--md-sys-color-on-surface)]">
                앱에서는 확인만 하고, 필요하면 폴더에서 직접 정리하세요.
              </p>
            </div>
          </div>
        </CardSection>
      </Card>

      <Card variant="outlined">
        <CardSection
          title="내용이 같은 파일 묶음"
          description="같은 내용이 여러 이름으로 저장된 후보를 묶음 단위로 압축해 보여줍니다."
          trailing={
            total > 0 ? (
              <Chip label={`${visibleStart}-${visibleEnd} / ${total}`} tone="neutral" icon="view_list" as="span" />
            ) : null
          }
        >
          <div className="mb-4 flex items-start gap-2 flex-wrap md:flex-nowrap">
            <div className="min-w-[260px] flex-1">
              <TextField
                leadingIcon="search"
                placeholder="파일명 또는 폴더명으로 현재 묶음 안에서 찾기"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {query && (
              <Button variant="text" leadingIcon="close" onClick={() => setQuery('')}>
                지우기
              </Button>
            )}
            <Chip label="현재 페이지 안에서 필터링" tone="neutral" icon="filter_list" as="span" />
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-12 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
              <Spinner size={18} /> 같은 내용 문서를 확인하는 중…
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon="rule_folder"
              title="파일명만 다른 동일 내용 문서를 찾지 못했습니다"
              description="새 문서를 추가했거나 내용이 바뀌었다면 설정에서 문서 새로고침을 실행한 뒤 다시 확인해 보세요."
            />
          ) : filteredGroups.length === 0 ? (
            <EmptyState
              icon="filter_alt_off"
              title="현재 검색어에 맞는 묶음이 없습니다"
              description="검색어를 지우거나 다른 파일명·폴더명으로 다시 찾아보세요."
              compact
            />
          ) : (
            <div className="space-y-3">
              {filteredGroups.map((group) => (
                <DuplicateGroupCard
                  key={group.content_signature}
                  group={group}
                  onOpenFile={openFile}
                  onShowInFolder={showInFolder}
                />
              ))}
            </div>
          )}

          {total > DUPLICATE_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                {visibleStart}-{visibleEnd} / {total}개 묶음
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outlined"
                  leadingIcon="chevron_left"
                  onClick={() => void fetchDuplicates(Math.max(0, offset - DUPLICATE_PAGE_SIZE))}
                  disabled={!hasPrevious || loading}
                >
                  이전
                </Button>
                <Button
                  variant="outlined"
                  trailingIcon="chevron_right"
                  onClick={() => void fetchDuplicates(offset + DUPLICATE_PAGE_SIZE)}
                  disabled={!hasNext || loading}
                >
                  다음
                </Button>
              </div>
            </div>
          )}
        </CardSection>
      </Card>
    </div>
  )
}

function DuplicateGroupCard({
  group,
  onOpenFile,
  onShowInFolder,
}: {
  group: DuplicateFileGroup
  onOpenFile: (file: DuplicateFileItem) => void
  onShowInFolder: (file: DuplicateFileItem) => void
}) {
  const newestId = newestFileId(group)
  return (
    <article className="console-panel overflow-hidden rounded-xl bg-[var(--md-sys-color-surface-container-lowest)]">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 py-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="tertiary">
              <Icon name="content_copy" size={14} />
              같은 내용
            </Badge>
            <Badge tone="neutral">{group.file_count}개 파일</Badge>
            <Badge tone="neutral">{group.distinct_name_count}개 이름</Badge>
            {group.file_types.slice(0, 3).map((fileType) => (
              <FileTypeBadge key={fileType} fileType={fileType} />
            ))}
          </div>
          <p className="truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={displayGroupTitle(group)}>
            {displayGroupTitle(group)}
          </p>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            {formatContentSize(group.total_content_chars)} · 최근 수정 {formatModifiedTime(group.latest_mtime)} · 내용 서명{' '}
            {signatureLabel(group.content_signature)}
          </p>
        </div>
        <span className="hidden rounded-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2.5 py-1 type-label-md text-[var(--md-sys-color-on-surface-variant)] md:inline-flex">
          확인 후보
        </span>
      </header>
      <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
        {group.files.map((file) => (
          <li
            key={file.id}
            className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-[var(--md-sys-color-surface-container-low)] lg:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileTypeBadge fileType={file.file_type} />
                <p className="min-w-0 flex-1 truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={file.name}>
                  {file.name}
                </p>
                {file.id === newestId && <Badge tone="success">최근 수정</Badge>}
              </div>
              <p className="mt-1 flex items-center gap-1.5 truncate type-body-sm text-[var(--md-sys-color-on-surface-variant)]" title={file.path}>
                <Icon name="folder" size={15} />
                <span className="truncate">{parentPath(file.path)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <span className="hidden type-body-sm text-[var(--md-sys-color-on-surface-variant)] sm:inline">
                {formatContentSize(file.content_chars)}
              </span>
              <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => onOpenFile(file)}>
                열기
              </Button>
              <Button variant="text" size="sm" leadingIcon="folder_open" onClick={() => onShowInFolder(file)}>
                폴더
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </article>
  )
}
