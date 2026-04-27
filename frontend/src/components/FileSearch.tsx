import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, SchedulerSettings, SearchResult, SearchScope } from '../api/client'
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  FileTypeBadge,
  Icon,
  IconButton,
  Radio,
  SegmentedButton,
  Spinner,
  TextField,
  useSnackbar,
} from '../ui'
import { EXAMPLE_SEARCH_QUERY } from '../tutorial'


const FILE_TYPE_FILTERS = [
  { label: 'Excel / XLSX·XLS', value: 'xlsx', icon: 'table_chart' },
  { label: 'Word / DOCX', value: 'docx', icon: 'article' },
  { label: 'PPT / PPTX', value: 'pptx', icon: 'slideshow' },
  { label: 'Markdown / MD', value: 'md', icon: 'docs' },
  { label: 'Text / TXT', value: 'txt', icon: 'description' },
]

const SEARCH_SCOPE_STATUS: Record<SearchScope, string> = {
  filename_content: '파일명과 본문을 함께 검색',
  filename: '파일명만 검색',
  content: '본문만 검색',
}

const SEARCH_SCOPE_DESCRIPTION: Record<SearchScope, string> = {
  filename_content: '파일 이름과 색인된 문서 본문을 함께 찾습니다.',
  filename: '파일 이름에 검색어가 포함된 문서만 찾습니다.',
  content: '색인된 문서 본문에서만 검색어를 찾고, 파일명 매칭은 제외합니다.',
}

const SEARCH_SCOPE_EMPTY: Record<SearchScope, string> = {
  filename_content: '오탈자를 확인하거나 더 짧은 키워드로 다시 시도해 보세요.',
  filename: '파일명만 검색 중입니다. 파일명+본문으로 범위를 넓혀 보세요.',
  content: '본문만 검색 중입니다. 파일명+본문으로 범위를 넓혀 보세요.',
}

const SEARCH_SCOPE_READY: Record<SearchScope, { title: string; description: string }> = {
  filename_content: {
    title: '파일명과 문서 내용을 한 번에 검색',
    description: '먼저 설정에서 대상 폴더를 추가하면 Excel, Word, PPT, 텍스트 파일 안의 단어까지 검색할 수 있습니다.',
  },
  filename: {
    title: '파일명으로 빠르게 검색',
    description: '파일명만 찾거나 검색 범위를 파일명+본문으로 바꿔 문서 안의 단어까지 검색할 수 있습니다.',
  },
  content: {
    title: '문서 본문만 정밀 검색',
    description: '파일명 매칭을 제외하고 Excel, Word, PPT, 텍스트 파일의 색인된 본문에서만 검색합니다.',
  },
}

const SEARCH_DEBOUNCE_MS = 600

type ModifiedDateFilter = 'all' | '7d' | '30d' | '90d' | 'custom'

const MODIFIED_DATE_FILTERS: Array<{ label: string; value: ModifiedDateFilter }> = [
  { label: '전체', value: 'all' },
  { label: '최근 7일', value: '7d' },
  { label: '최근 30일', value: '30d' },
  { label: '최근 90일', value: '90d' },
  { label: '직접 기간', value: 'custom' },
]

function formatDateInput(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function dateDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return formatDateInput(date)
}

function SnippetText({ snippet }: { snippet: string }) {
  const parts = snippet.split('**')
  return (
    <span className="type-body-md text-[var(--md-sys-color-on-surface)] leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] rounded-xs px-1 py-[1px]"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

function SearchResultListItem({
  item,
  onOpen,
}: {
  item: SearchResult
  onOpen: (fileId: number, fileName: string) => void
}) {
  return (
    <li className="px-5 py-3 border-t border-[var(--md-sys-color-outline-variant)] first:border-t-0 hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors">
      <button
        type="button"
        onClick={() => onOpen(item.file_id, item.name)}
        className="block w-full text-left rounded-md"
      >
        <p className="type-label-md text-[var(--md-sys-color-primary)] mb-1 inline-flex items-center gap-1.5">
          <Icon name="my_location" size={14} />
          {item.location}
        </p>
        <SnippetText snippet={item.snippet} />
      </button>
    </li>
  )
}

export default function FileSearch({
  tutorialActive = false,
  onTutorialSearchComplete,
}: {
  tutorialActive?: boolean
  onTutorialSearchComplete?: () => void
}) {
  const snackbar = useSnackbar()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([])
  const [searchScope, setSearchScope] = useState<SearchScope>('filename_content')
  const [modifiedDateFilter, setModifiedDateFilter] = useState<ModifiedDateFilter>('all')
  const [customModifiedFrom, setCustomModifiedFrom] = useState('')
  const [customModifiedTo, setCustomModifiedTo] = useState('')
  const [expandedContentFiles, setExpandedContentFiles] = useState<Set<string>>(new Set())

  const [settings, setSettings] = useState<SchedulerSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SchedulerSettings | null>(null)
  const [reindexing, setReindexing] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestSeq = useRef(0)

  useEffect(() => {
    api.search.getSettings().then((response) => {
      setSettings(response.data)
      setSettingsDraft(response.data)
    })
  }, [])

  useEffect(() => {
    if (!tutorialActive) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setQuery(EXAMPLE_SEARCH_QUERY)
    setSearchScope('filename_content')
  }, [tutorialActive])

  const buildModifiedDateParams = useCallback(
    (
      filter: ModifiedDateFilter = modifiedDateFilter,
      customFrom: string = customModifiedFrom,
      customTo: string = customModifiedTo,
    ) => {
      if (filter === 'all') return {}
      if (filter === 'custom') {
        return {
          modified_from: customFrom || undefined,
          modified_to: customTo || undefined,
        }
      }

      const days = filter === '7d' ? 7 : filter === '30d' ? 30 : 90
      return {
        modified_from: dateDaysAgo(days),
        modified_to: formatDateInput(new Date()),
      }
    },
    [customModifiedFrom, customModifiedTo, modifiedDateFilter],
  )

  const doSearch = useCallback(
    async (
      q: string,
      fileTypes = selectedFileTypes,
      scope = searchScope,
      dateFilter = modifiedDateFilter,
      customFrom = customModifiedFrom,
      customTo = customModifiedTo,
    ) => {
      const requestId = searchRequestSeq.current + 1
      searchRequestSeq.current = requestId

      if (!q.trim()) {
        setResults([])
        setSearched(false)
        setExpandedContentFiles(new Set())
        setLoading(false)
        return false
      }
      setLoading(true)
      try {
        const modifiedDateParams = buildModifiedDateParams(dateFilter, customFrom, customTo)
        const response = await api.search.query({
          query: q,
          limit: 200,
          file_types: fileTypes.length > 0 ? fileTypes : undefined,
          search_scope: scope,
          ...modifiedDateParams,
        })
        if (requestId !== searchRequestSeq.current) return false
        setResults(response.data.results)
        setExpandedContentFiles(new Set())
        setSearched(true)
        return response.data.results.length > 0
      } catch {
        if (requestId !== searchRequestSeq.current) return false
        setResults([])
        snackbar.error('검색에 실패했습니다.')
        return false
      } finally {
        if (requestId === searchRequestSeq.current) setLoading(false)
      }
    },
    [
      buildModifiedDateParams,
      customModifiedFrom,
      customModifiedTo,
      modifiedDateFilter,
      selectedFileTypes,
      searchScope,
      snackbar,
    ],
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value), SEARCH_DEBOUNCE_MS)
  }

  const toggleFileType = (value: string) => {
    const next = selectedFileTypes.includes(value)
      ? selectedFileTypes.filter((item) => item !== value)
      : [...selectedFileTypes, value]
    setSelectedFileTypes(next)
    if (query.trim()) {
      void doSearch(query, next, searchScope, modifiedDateFilter, customModifiedFrom, customModifiedTo)
    }
  }

  const handleSearchScopeChange = (next: SearchScope) => {
    setSearchScope(next)
    if (query.trim()) {
      void doSearch(query, selectedFileTypes, next, modifiedDateFilter, customModifiedFrom, customModifiedTo)
    }
  }

  const handleResetFileTypes = () => {
    setSelectedFileTypes([])
    if (query.trim()) {
      void doSearch(query, [], searchScope, modifiedDateFilter, customModifiedFrom, customModifiedTo)
    }
  }

  const handleModifiedDateFilterChange = (next: ModifiedDateFilter) => {
    setModifiedDateFilter(next)
    if (query.trim()) {
      void doSearch(query, selectedFileTypes, searchScope, next, customModifiedFrom, customModifiedTo)
    }
  }

  const handleCustomModifiedFromChange = (value: string) => {
    setCustomModifiedFrom(value)
    if (modifiedDateFilter === 'custom' && query.trim()) {
      void doSearch(query, selectedFileTypes, searchScope, 'custom', value, customModifiedTo)
    }
  }

  const handleCustomModifiedToChange = (value: string) => {
    setCustomModifiedTo(value)
    if (modifiedDateFilter === 'custom' && query.trim()) {
      void doSearch(query, selectedFileTypes, searchScope, 'custom', customModifiedFrom, value)
    }
  }

  const toggleContentMatches = (fileKey: string) => {
    setExpandedContentFiles((current) => {
      const next = new Set(current)
      if (next.has(fileKey)) {
        next.delete(fileKey)
      } else {
        next.add(fileKey)
      }
      return next
    })
  }

  const handleReindex = async () => {
    setReindexing(true)
    try {
      const response = await api.search.reindex()
      snackbar.success(
        `검색 갱신 완료 · 성공 ${response.data.success} · 실패 ${response.data.failed}`,
      )
      const next = await api.search.getSettings()
      setSettings(next.data)
      setSettingsDraft(next.data)
    } catch {
      snackbar.error('검색 갱신에 실패했습니다.')
    } finally {
      setReindexing(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!settingsDraft) return
    const intervalHours = Math.floor(Number(settingsDraft.interval_hours))
    if (settingsDraft.mode === 'interval' && (!Number.isFinite(intervalHours) || intervalHours < 1)) {
      snackbar.warn('반복 주기는 1 이상인 정수만 입력할 수 있습니다.')
      return
    }
    try {
      const response = await api.search.updateSettings({
        ...settingsDraft,
        interval_hours: settingsDraft.mode === 'interval' ? intervalHours : settingsDraft.interval_hours,
      })
      setSettings(response.data)
      setSettingsOpen(false)
      snackbar.success('검색 갱신 주기가 저장되었습니다.')
    } catch {
      snackbar.error('설정 저장에 실패했습니다.')
    }
  }

  const handleOpenFile = async (fileId: number, fileName: string) => {
    try {
      await api.files.open(fileId)
      snackbar.info(`"${fileName}" 열기 요청을 보냈습니다.`)
    } catch {
      snackbar.error('파일을 열지 못했습니다. 파일 경로가 바뀌었는지 확인해 주세요.')
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>()
    for (const result of results) {
      const list = map.get(result.name) ?? []
      list.push(result)
      map.set(result.name, list)
    }
    return Array.from(map.entries())
  }, [results])

  const contentFileKeys = useMemo(
    () =>
      grouped
        .filter(([, items]) => items.some((item) => item.location !== '파일명'))
        .map(([fileName, items]) => `${items[0].file_id}:${fileName}`),
    [grouped],
  )

  const activeModifiedDateLabel = useMemo(
    () =>
      MODIFIED_DATE_FILTERS.find((filter) => filter.value === modifiedDateFilter)?.label ?? '전체',
    [modifiedDateFilter],
  )
  const allContentMatchesExpanded =
    contentFileKeys.length > 0 && contentFileKeys.every((key) => expandedContentFiles.has(key))

  const expandAllContentMatches = () => {
    setExpandedContentFiles(new Set(contentFileKeys))
  }

  const collapseAllContentMatches = () => {
    setExpandedContentFiles(new Set())
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      searchRequestSeq.current += 1
    }
  }, [])

  const hasResults = !loading && results.length > 0
  const lastReindex = settings?.last_reindex_at
    ? new Date(settings.last_reindex_at).toLocaleString('ko-KR')
    : null

  return (
    <div className="space-y-6">
      <Card variant="elevated" className="console-panel p-5 md:p-6 space-y-5">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="flex-1">
            <TextField
              leadingIcon="search"
              placeholder="파일 안의 단어를 검색 (예: 회의록, 예산안, 실험 결과)"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              className="h-12 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] pr-11 text-[1rem] shadow-[0_1px_0_rgba(255,255,255,0.95)_inset,0_0_0_1px_rgba(15,23,42,0.05)]"
              trailing={
                query ? (
                  <IconButton
                    icon="close"
                    label="검색어 지우기"
                    size="sm"
                    onClick={() => {
                      if (debounceRef.current) clearTimeout(debounceRef.current)
                      searchRequestSeq.current += 1
                      setQuery('')
                      setResults([])
                      setSearched(false)
                      setExpandedContentFiles(new Set())
                      setLoading(false)
                    }}
                  />
                ) : null
              }
            />
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="filled"
              leadingIcon="search"
              onClick={() => {
                void doSearch(query, selectedFileTypes, searchScope).then((hasResults) => {
                  if (!tutorialActive) return
                  if (hasResults) {
                    onTutorialSearchComplete?.()
                  } else {
                    snackbar.warn('예제 검색 결과가 아직 없습니다. 문서 새로고침 완료 후 다시 검색해 주세요.')
                  }
                })
              }}
              disabled={!query.trim() || loading}
              className={tutorialActive ? 'attention-pulse tour-target' : ''}
            >
              검색
            </Button>
            <IconButton
              icon={settingsOpen ? 'tune' : 'tune'}
              label="검색 갱신 주기"
              variant="outlined"
              onClick={() => setSettingsOpen((open) => !open)}
              selected={settingsOpen}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="bolt" size={16} /> {SEARCH_SCOPE_STATUS[searchScope]}
          </span>
          {lastReindex && (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="schedule" size={16} /> 마지막 검색 갱신 {lastReindex}
            </span>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.55fr)]">
          <div className="console-subpanel rounded-lg p-4 space-y-2">
            <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">검색 범위</span>
            <div>
              <SegmentedButton<SearchScope>
                aria-label="검색 범위"
                value={searchScope}
                onChange={handleSearchScopeChange}
                options={[
                  { value: 'filename_content', label: '파일명 + 본문', icon: 'article' },
                  { value: 'filename', label: '파일명만', icon: 'drive_file_rename_outline' },
                  { value: 'content', label: '본문만', icon: 'subject' },
                ]}
              />
            </div>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {SEARCH_SCOPE_DESCRIPTION[searchScope]}
            </p>
          </div>
          <div className="console-subpanel rounded-lg p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">문서 형식</span>
              {FILE_TYPE_FILTERS.map((filter) => {
                const selected = selectedFileTypes.includes(filter.value)
                return (
                  <Chip
                    key={filter.value}
                    label={filter.label}
                    icon={filter.icon}
                    kind="filter"
                    selected={selected}
                    aria-pressed={selected}
                    onClick={() => toggleFileType(filter.value)}
                  />
                )
              })}
              <Button
                variant="text"
                size="sm"
                leadingIcon="restart_alt"
                onClick={handleResetFileTypes}
                disabled={selectedFileTypes.length === 0}
              >
                초기화
              </Button>
            </div>
          </div>
          <div className="console-subpanel rounded-lg p-4 space-y-2 lg:col-span-2">
            <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">수정일</span>
            <div className="flex items-center gap-2 flex-wrap">
              {MODIFIED_DATE_FILTERS.map((filter) => (
                <Chip
                  key={filter.value}
                  label={filter.label}
                  kind="filter"
                  selected={modifiedDateFilter === filter.value}
                  onClick={() => handleModifiedDateFilterChange(filter.value)}
                />
              ))}
            </div>
            {modifiedDateFilter === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)] gap-2">
                <TextField
                  label="시작일"
                  type="date"
                  value={customModifiedFrom}
                  onChange={(event) => handleCustomModifiedFromChange(event.target.value)}
                />
                <TextField
                  label="종료일"
                  type="date"
                  value={customModifiedTo}
                  onChange={(event) => handleCustomModifiedToChange(event.target.value)}
                />
              </div>
            )}
          </div>
        </div>
      </Card>

      {settingsOpen && settingsDraft && (
        <Card variant="elevated" className="console-panel p-5 space-y-4 animate-slide-up">
          <div>
            <p className="type-title-md text-[var(--md-sys-color-on-surface)]">검색 갱신 주기</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              검색 결과가 최신 상태가 되도록 변경된 파일만 다시 읽습니다.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Radio
              name="reindex-mode"
              checked={settingsDraft.mode === 'manual'}
              onChange={() => setSettingsDraft({ ...settingsDraft, mode: 'manual' })}
              label="수동"
              description="필요할 때 이 설정 영역에서 수동 갱신을 실행합니다."
            />
            <Radio
              name="reindex-mode"
              checked={settingsDraft.mode === 'interval'}
              onChange={() => setSettingsDraft({ ...settingsDraft, mode: 'interval' })}
              label="주기 반복"
              description="지정한 시간마다 변경된 파일을 자동으로 다시 읽습니다."
            />
            <Radio
              name="reindex-mode"
              checked={settingsDraft.mode === 'daily'}
              onChange={() => setSettingsDraft({ ...settingsDraft, mode: 'daily' })}
              label="매일 정시"
              description="매일 지정한 시각에 검색 색인을 갱신합니다."
            />
          </div>

          {settingsDraft.mode === 'interval' && (
            <div className="flex items-center gap-2">
              <TextField
                label="반복 주기(시간)"
                type="number"
                min={1}
                max={72}
                step={1}
                value={settingsDraft.interval_hours}
                onChange={(event) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    interval_hours: Number(event.target.value),
                  })
                }
                className="w-40"
                fullWidth={false}
              />
            </div>
          )}

          {settingsDraft.mode === 'daily' && (
            <TextField
              label="실행 시각"
              type="time"
              value={settingsDraft.daily_time}
              onChange={(event) =>
                setSettingsDraft({ ...settingsDraft, daily_time: event.target.value })
              }
              className="w-40"
              fullWidth={false}
            />
          )}

          <div className="flex justify-between gap-2 pt-1 flex-wrap">
            <Button variant="tonal" leadingIcon="refresh" onClick={handleReindex} loading={reindexing}>
              지금 검색 색인 갱신
            </Button>
            <div className="flex gap-2">
              <Button variant="text" onClick={() => setSettingsOpen(false)}>
                취소
              </Button>
              <Button variant="filled" leadingIcon="save" onClick={handleSaveSettings}>
                저장
              </Button>
            </div>
          </div>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
          <Spinner size={20} />
          <span>검색 중…</span>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <EmptyState
          icon="search_off"
          title={`"${query}"에 대한 결과가 없습니다.`}
          description={SEARCH_SCOPE_EMPTY[searchScope]}
        />
      )}

      {!loading && !searched && !query && (
        <EmptyState
          icon="manage_search"
          title={SEARCH_SCOPE_READY[searchScope].title}
          description={SEARCH_SCOPE_READY[searchScope].description}
        />
      )}

      {hasResults && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)]/80 p-3">
            <Chip label={`${results.length}건`} tone="primary" as="span" icon="filter_list" />
            {selectedFileTypes.length > 0 && (
              <Chip label={`형식 ${selectedFileTypes.length}개 선택`} tone="secondary" as="span" icon="checklist" />
            )}
            {modifiedDateFilter !== 'all' && (
              <Chip label={`수정일 ${activeModifiedDateLabel}`} tone="secondary" as="span" icon="event" />
            )}
            <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {grouped.length}개 파일에서 매칭됨
            </span>
            {contentFileKeys.length > 0 && (
              <div className="ml-auto flex gap-2 flex-wrap">
                <Button
                  variant="text"
                  size="sm"
                  leadingIcon="unfold_more"
                  onClick={expandAllContentMatches}
                  disabled={allContentMatchesExpanded}
                >
                  본문 전체 열기
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  leadingIcon="unfold_less"
                  onClick={collapseAllContentMatches}
                  disabled={expandedContentFiles.size === 0}
                >
                  본문 전체 접기
                </Button>
              </div>
            )}
          </div>
          {grouped.map(([fileName, items]) => {
            const fileKey = `${items[0].file_id}:${fileName}`
            const filenameItems = items.filter((item) => item.location === '파일명')
            const contentItems = items.filter((item) => item.location !== '파일명')
            const contentExpanded = expandedContentFiles.has(fileKey)

            return (
              <Card key={fileKey} variant="outlined" className="overflow-hidden console-panel shadow-none">
                <header className="px-5 py-3.5 flex items-center gap-2 flex-wrap border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]/62">
                  <FileTypeBadge fileType={items[0].file_type} />
                  <span className="type-title-sm text-[var(--md-sys-color-on-surface)] truncate flex-1 min-w-0">
                    {fileName}
                  </span>
                  <Badge tone="neutral">{items.length}건</Badge>
                  <Button
                    variant="text"
                    size="sm"
                    leadingIcon="open_in_new"
                    onClick={() => handleOpenFile(items[0].file_id, fileName)}
                  >
                    열기
                  </Button>
                </header>
                <ul>
                  {filenameItems.map((item, index) => (
                    <SearchResultListItem
                      key={`filename-${item.file_id}-${index}`}
                      item={item}
                      onOpen={handleOpenFile}
                    />
                  ))}
                  {contentItems.length > 0 && (
                    <li className="px-5 py-3 border-t border-[var(--md-sys-color-outline-variant)] first:border-t-0">
                      <Button
                        variant="tonal"
                        size="sm"
                        leadingIcon={contentExpanded ? 'expand_less' : 'expand_more'}
                        onClick={() => toggleContentMatches(fileKey)}
                      >
                        {contentExpanded
                          ? '본문 매칭 접기'
                          : `본문 매칭 ${contentItems.length}건 보기`}
                      </Button>
                    </li>
                  )}
                  {contentExpanded &&
                    contentItems.map((item, index) => (
                      <SearchResultListItem
                        key={`content-${item.file_id}-${item.location}-${index}`}
                        item={item}
                        onOpen={handleOpenFile}
                      />
                    ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
