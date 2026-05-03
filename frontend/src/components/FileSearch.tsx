import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, SchedulerSettings, SearchResponse, SearchResult, SearchScope } from '../api/client'
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
import { TutorialStep } from '../tutorial'

const FILE_TYPE_FILTERS = [
  { label: '.xlsx', value: 'xlsx', icon: 'table_chart' },
  { label: '.docx', value: 'docx', icon: 'article' },
  { label: '.pptx', value: 'pptx', icon: 'slideshow' },
]

const SEARCH_SCOPE_STATUS: Record<SearchScope, string> = {
  filename_content: '파일명과 내용 함께 검색',
  filename: '파일명만 검색',
  content: '문서 내용만 검색',
}

const SEARCH_SCOPE_DESCRIPTION: Record<SearchScope, string> = {
  filename_content: '파일 이름과 문서 내용을 함께 찾습니다.',
  filename: '파일 이름에 검색어가 포함된 문서만 찾습니다.',
  content: '문서 내용에서만 검색어를 찾고, 파일명 일치는 제외합니다.',
}

const SEARCH_SCOPE_EMPTY: Record<SearchScope, string> = {
  filename_content: '오탈자를 확인하거나 더 짧은 키워드로 다시 시도해 보세요.',
  filename: '파일명만 검색 중입니다. 파일명+내용으로 범위를 넓혀 보세요.',
  content: '문서 내용만 검색 중입니다. 파일명+내용으로 범위를 넓혀 보세요.',
}

const SEARCH_SCOPE_READY: Record<SearchScope, { title: string; description: string }> = {
  filename_content: {
    title: '파일명과 문서 내용을 한 번에 검색',
    description: '먼저 설정에서 대상 폴더를 추가하면 Excel, Word, PPT 문서 안의 단어까지 검색할 수 있습니다.',
  },
  filename: {
    title: '파일명으로 빠르게 검색',
    description: '파일명만 찾거나 검색 범위를 파일명+내용으로 바꿔 문서 안의 단어까지 검색할 수 있습니다.',
  },
  content: {
    title: '문서 내용만 정밀 검색',
    description: '파일명 일치를 제외하고 Excel, Word, PPT 문서 내용에서만 검색합니다.',
  },
}

const SEARCH_DEBOUNCE_MS = 600
const INITIAL_SEARCH_FILE_LIMIT = 20
const SEARCH_FILE_LIMIT_STEP = 20
const MAX_SEARCH_FILE_LIMIT = 100

type ModifiedDateFilter = 'all' | '7d' | '30d' | '90d' | 'custom'

interface SearchMeta {
  fileCount: number
  fileLimit: number
  hasMore: boolean
}

interface PrefetchedSearch {
  key: string
  fileLimit: number
  data: SearchResponse
}

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

function HighlightedSnippet({
  snippet,
  className = 'type-body-md text-[var(--md-sys-color-on-surface)] leading-relaxed',
}: {
  snippet: string
  className?: string
}) {
  const parts = snippet.split('**')
  return (
    <span className={className}>
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

function SnippetText({ snippet }: { snippet: string }) {
  return <HighlightedSnippet snippet={snippet} />
}

function getContentFileKey(item: SearchResult) {
  return `${item.file_id}:${item.name}`
}

function getContentFileKeys(results: SearchResult[]) {
  const keys = new Set<string>()
  for (const result of results) {
    if (result.location !== '파일명') {
      keys.add(getContentFileKey(result))
    }
  }
  return keys
}

function SearchResultListItem({
  item,
  onOpen,
  highlightTour = false,
  tourHint,
}: {
  item: SearchResult
  onOpen: (fileId: number, fileName: string) => void
  highlightTour?: boolean
  tourHint?: string
}) {
  return (
    <li
      className={`px-5 py-3 border-t border-[var(--md-sys-color-outline-variant)] first:border-t-0 hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors ${
        highlightTour ? 'tour-target tour-review-target rounded-xl' : ''
      }`}
      data-tour-target={highlightTour ? 'search-review' : undefined}
    >
      <button
        type="button"
        onClick={() => onOpen(item.file_id, item.name)}
        className="block w-full text-left rounded-md"
      >
        <p className="type-label-md text-[var(--md-sys-color-primary)] mb-1 inline-flex items-center gap-1.5">
          <Icon name="my_location" size={14} />
          {item.location}
        </p>
        {tourHint && (
          <span className="tour-evidence-note mb-2">
            <Icon name="auto_awesome" size={14} />
            {tourHint}
          </span>
        )}
        <SnippetText snippet={item.snippet} />
      </button>
    </li>
  )
}

export default function FileSearch({
  tutorialStep,
  libraryDataRevision = 0,
  onTutorialStep,
}: {
  tutorialStep?: TutorialStep | null
  libraryDataRevision?: number
  onTutorialStep?: (step: TutorialStep | null) => void
}) {
  const snackbar = useSnackbar()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchMeta, setSearchMeta] = useState<SearchMeta>({
    fileCount: 0,
    fileLimit: INITIAL_SEARCH_FILE_LIMIT,
    hasMore: false,
  })
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [prefetching, setPrefetching] = useState(false)
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
  const prefetchedSearchRef = useRef<PrefetchedSearch | null>(null)

  useEffect(() => {
    api.search.getSettings().then((response) => {
      setSettings(response.data)
      setSettingsDraft(response.data)
    })
  }, [])

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

  const searchKey = (
    q: string,
    fileTypes: string[],
    scope: SearchScope,
    dateFilter: ModifiedDateFilter,
    customFrom: string,
    customTo: string,
  ) => JSON.stringify([q.trim(), [...fileTypes].sort(), scope, dateFilter, customFrom, customTo])

  const applySearchResponse = (
    data: SearchResponse,
    fallbackFileLimit: number,
    keepExpandedContentFiles = false,
  ) => {
    setResults(data.results)
    setSearchMeta({
      fileCount: data.file_count ?? new Set(data.results.map((item) => item.file_id)).size,
      fileLimit: data.file_limit ?? fallbackFileLimit,
      hasMore: Boolean(data.has_more),
    })
    setExpandedContentFiles((current) => {
      if (!keepExpandedContentFiles) return new Set()

      const nextContentFileKeys = getContentFileKeys(data.results)
      return new Set([...current].filter((fileKey) => nextContentFileKeys.has(fileKey)))
    })
    setSearched(true)
    return data.results.length > 0
  }

  const doSearch = useCallback(
    async (
      q: string,
      fileTypes = selectedFileTypes,
      scope = searchScope,
      dateFilter = modifiedDateFilter,
      customFrom = customModifiedFrom,
      customTo = customModifiedTo,
      fileLimit = INITIAL_SEARCH_FILE_LIMIT,
      mode: 'replace' | 'more' = 'replace',
    ) => {
      const requestId = searchRequestSeq.current + 1
      searchRequestSeq.current = requestId

      if (!q.trim()) {
        setResults([])
        setSearchMeta({
          fileCount: 0,
          fileLimit: INITIAL_SEARCH_FILE_LIMIT,
          hasMore: false,
        })
        setSearched(false)
        setExpandedContentFiles(new Set())
        setLoading(false)
        setLoadingMore(false)
        setPrefetching(false)
        prefetchedSearchRef.current = null
        return false
      }
      const nextFileLimit = Math.min(Math.max(fileLimit, INITIAL_SEARCH_FILE_LIMIT), MAX_SEARCH_FILE_LIMIT)
      const baseKey = searchKey(q, fileTypes, scope, dateFilter, customFrom, customTo)
      const prefetched = prefetchedSearchRef.current
      if (mode === 'replace') prefetchedSearchRef.current = null
      if (mode === 'more') {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      try {
        const modifiedDateParams = buildModifiedDateParams(dateFilter, customFrom, customTo)
        const response =
          mode === 'more' && prefetched?.key === baseKey && prefetched.fileLimit === nextFileLimit
            ? { data: prefetched.data }
            : await api.search.query({
                query: q,
                limit: nextFileLimit * 4,
                file_limit: nextFileLimit,
                file_types: fileTypes.length > 0 ? fileTypes : undefined,
                search_scope: scope,
                ...modifiedDateParams,
              })
        if (requestId !== searchRequestSeq.current) return false
        prefetchedSearchRef.current = null
        const hasResults = applySearchResponse(response.data, nextFileLimit, mode === 'more')
        const preloadFileLimit = Math.min(nextFileLimit + SEARCH_FILE_LIMIT_STEP, MAX_SEARCH_FILE_LIMIT)
        if (response.data.has_more && preloadFileLimit > nextFileLimit) {
          setPrefetching(true)
          void api.search
            .query({
              query: q,
              limit: preloadFileLimit * 4,
              file_limit: preloadFileLimit,
              file_types: fileTypes.length > 0 ? fileTypes : undefined,
              search_scope: scope,
              ...modifiedDateParams,
            })
            .then((prefetchResponse) => {
              if (requestId !== searchRequestSeq.current) return
              prefetchedSearchRef.current = {
                key: baseKey,
                fileLimit: preloadFileLimit,
                data: prefetchResponse.data,
              }
            })
            .catch(() => {
              if (requestId === searchRequestSeq.current) prefetchedSearchRef.current = null
            })
            .finally(() => {
              if (requestId === searchRequestSeq.current) setPrefetching(false)
            })
        } else {
          setPrefetching(false)
        }
        return hasResults
      } catch {
        if (requestId !== searchRequestSeq.current) return false
        setResults([])
        setSearchMeta({
          fileCount: 0,
          fileLimit: INITIAL_SEARCH_FILE_LIMIT,
          hasMore: false,
        })
        prefetchedSearchRef.current = null
        snackbar.error('검색에 실패했습니다.')
        return false
      } finally {
        if (requestId === searchRequestSeq.current) {
          setLoading(false)
          setLoadingMore(false)
        }
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
    const willExpand = !expandedContentFiles.has(fileKey)
    setExpandedContentFiles((current) => {
      const next = new Set(current)
      if (next.has(fileKey)) {
        next.delete(fileKey)
      } else {
        next.add(fileKey)
      }
      return next
    })
    if (willExpand && tutorialStep === 'search-results') onTutorialStep?.('search-review')
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
      snackbar.success('검색 최신화 설정이 저장되었습니다.')
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

  const handleShowInFolder = async (fileId: number, fileName: string, filePath: string) => {
    try {
      await api.files.showInFolder(fileId, filePath)
      snackbar.info(`"${fileName}" 위치 열기 요청을 보냈습니다.`)
    } catch {
      snackbar.error('폴더를 열지 못했습니다. 파일 경로가 바뀌었는지 확인해 주세요.')
    }
  }

  useEffect(() => {
    if (libraryDataRevision === 0) return
    if (!query.trim()) {
      setResults([])
      setSearchMeta({
        fileCount: 0,
        fileLimit: INITIAL_SEARCH_FILE_LIMIT,
        hasMore: false,
      })
      setSearched(false)
      setExpandedContentFiles(new Set())
      return
    }
    void doSearch(query)
  }, [libraryDataRevision])

  const grouped = useMemo(() => {
    const map = new Map<string, { fileName: string; items: SearchResult[] }>()
    for (const result of results) {
      const fileKey = `${result.file_id}:${result.path}`
      const entry = map.get(fileKey) ?? { fileName: result.name, items: [] }
      entry.items.push(result)
      map.set(fileKey, entry)
    }
    return Array.from(map.values()).map(({ fileName, items }) => [fileName, items] as [string, SearchResult[]])
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
  const hasResults = !loading && results.length > 0
  const tutorialSearchReviewKey = tutorialStep === 'search-review' ? contentFileKeys[0] : null

  const expandAllContentMatches = () => {
    setExpandedContentFiles(new Set(contentFileKeys))
    if (tutorialStep === 'search-results') onTutorialStep?.('search-review')
  }

  const collapseAllContentMatches = () => {
    setExpandedContentFiles(new Set())
  }

  const loadMoreFiles = () => {
    if (!searchMeta.hasMore || loadingMore || loading) return
    const nextLimit = Math.min(searchMeta.fileLimit + SEARCH_FILE_LIMIT_STEP, MAX_SEARCH_FILE_LIMIT)
    void doSearch(
      query,
      selectedFileTypes,
      searchScope,
      modifiedDateFilter,
      customModifiedFrom,
      customModifiedTo,
      nextLimit,
      'more',
    )
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      searchRequestSeq.current += 1
    }
  }, [])

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
              className="h-12 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] pr-11 text-[1rem] shadow-[0_1px_0_var(--ow-inset-highlight)_inset,0_0_0_1px_color-mix(in_srgb,var(--md-sys-color-outline-variant)_55%,transparent)]"
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
                      setSearchMeta({
                        fileCount: 0,
                        fileLimit: INITIAL_SEARCH_FILE_LIMIT,
                        hasMore: false,
                      })
                      setSearched(false)
                      setExpandedContentFiles(new Set())
                      setLoading(false)
                      setLoadingMore(false)
                      setPrefetching(false)
                      prefetchedSearchRef.current = null
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
                  if (tutorialStep !== 'search') return
                  if (hasResults) {
                    onTutorialStep?.('search-results')
                  } else {
                    snackbar.warn('예제 검색 결과가 아직 없습니다. 문서 새로고침 완료 후 다시 검색해 주세요.')
                  }
                })
              }}
              disabled={!query.trim() || loading}
              className={tutorialStep === 'search' ? 'attention-pulse tour-target' : ''}
              data-tour-target={tutorialStep === 'search' ? 'search' : undefined}
            >
              검색
            </Button>
            <IconButton
              icon={settingsOpen ? 'tune' : 'tune'}
              label="검색 최신화 설정"
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
          {tutorialStep === 'search' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--md-sys-color-primary)]/20 bg-[var(--md-sys-color-primary-container)]/55 px-3 py-1 text-[var(--md-sys-color-on-primary-container)]">
              <Icon name="auto_awesome" size={16} />
              프로젝트를 입력하면 파일명과 내용을 함께 찾아요
            </span>
          )}
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
            <p className="type-title-md text-[var(--md-sys-color-on-surface)]">검색 최신화 설정</p>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              검색 결과가 최신 상태가 되도록 변경된 파일만 다시 확인합니다.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Radio
              name="reindex-mode"
              checked={settingsDraft.mode === 'manual'}
              onChange={() => setSettingsDraft({ ...settingsDraft, mode: 'manual' })}
              label="수동"
              description="필요할 때 이 설정 영역에서 직접 최신화합니다."
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
              description="매일 지정한 시각에 검색 결과를 최신 상태로 준비합니다."
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
              지금 검색 결과 최신화
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
            <Chip label={`${searchMeta.fileCount}개 파일`} tone="primary" as="span" icon="folder_open" />
            <Chip label={`${results.length}개 위치`} tone="neutral" as="span" icon="filter_list" />
            {selectedFileTypes.length > 0 && (
              <Chip label={`형식 ${selectedFileTypes.length}개 선택`} tone="secondary" as="span" icon="checklist" />
            )}
            {modifiedDateFilter !== 'all' && (
              <Chip label={`수정일 ${activeModifiedDateLabel}`} tone="secondary" as="span" icon="event" />
            )}
            <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              관련도 높은 결과부터 가볍게 보여줍니다
              {prefetching ? ' · 다음 결과 준비 중' : ''}
            </span>
            {contentFileKeys.length > 0 && (
              <div className="ml-auto flex gap-2 flex-wrap">
                <Button
                  variant="text"
                  size="sm"
                  leadingIcon="unfold_more"
                  onClick={expandAllContentMatches}
                  disabled={allContentMatchesExpanded}
                  className={tutorialStep === 'search-results' ? 'attention-pulse tour-target' : ''}
                  data-tour-target={tutorialStep === 'search-results' ? 'search-results' : undefined}
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
          <div>
            {grouped.map(([fileName, items]) => {
              const fileKey = `${items[0].file_id}:${fileName}`
              const filenameItems = items.filter((item) => item.location === '파일명')
              const contentItems = items.filter((item) => item.location !== '파일명')
              const contentExpanded = expandedContentFiles.has(fileKey)
              const titleSnippet = filenameItems[0]?.snippet ?? fileName

              return (
                <Card key={fileKey} variant="outlined" className="overflow-hidden console-panel shadow-none">
                  <header className="px-5 py-3.5 flex items-center gap-2 flex-wrap border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]/62">
                    <FileTypeBadge fileType={items[0].file_type} />
                    <span className="type-title-sm text-[var(--md-sys-color-on-surface)] truncate flex-1 min-w-0">
                      <HighlightedSnippet
                        snippet={titleSnippet}
                        className="type-title-sm text-[var(--md-sys-color-on-surface)]"
                      />
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
                    <Button
                      variant="text"
                      size="sm"
                      leadingIcon="folder_open"
                      onClick={() => handleShowInFolder(items[0].file_id, fileName, items[0].path)}
                    >
                      폴더에서 보기
                    </Button>
                  </header>
                  <ul>
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
                          highlightTour={fileKey === tutorialSearchReviewKey && index === 0}
                          tourHint={
                            fileKey === tutorialSearchReviewKey && index === 0
                              ? '초성이 본문 매칭으로 이어졌어요'
                              : undefined
                          }
                        />
                      ))}
                  </ul>
                </Card>
              )
            })}
          </div>
          {searchMeta.hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="tonal"
                leadingIcon="expand_more"
                onClick={loadMoreFiles}
                loading={loadingMore}
                disabled={loadingMore || loading}
              >
                더 보기 · 최대 {MAX_SEARCH_FILE_LIMIT}개 파일
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
