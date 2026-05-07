import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  api,
  type FileInfo,
  type SearchResponse,
  type SearchResult,
  type SearchScope,
  type WatchedFolder,
} from '../api/client'
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  FileTypeBadge,
  Icon,
  IconButton,
  SegmentedButton,
  Spinner,
  TextField,
  useSnackbar,
} from '../ui'
import { EXAMPLE_SEARCH_QUERY, TutorialStep } from '../tutorial'

const FILE_TYPE_FILTERS = [
  { label: '.xlsx', value: 'xlsx', icon: 'table_chart' },
  { label: '.docx', value: 'docx', icon: 'article' },
  { label: '.pptx', value: 'pptx', icon: 'slideshow' },
  { label: '.pdf', value: 'pdf', icon: 'picture_as_pdf' },
]

const SEARCH_SCOPE_STATUS: Record<SearchScope, string> = {
  filename_content: '파일명 + 본문 검색',
  filename: '파일명만 검색',
  content: '본문만 검색',
}

const SEARCH_SCOPE_DESCRIPTION: Record<SearchScope, string> = {
  filename_content: '파일 이름과 문서 본문을 함께 찾습니다.',
  filename: '파일 이름에 검색어가 포함된 문서만 찾습니다.',
  content: '문서 본문에서만 검색어를 찾고, 파일명 일치는 제외합니다.',
}

const SEARCH_SCOPE_EMPTY: Record<SearchScope, string> = {
  filename_content: '오탈자를 확인하거나 더 짧은 키워드로 다시 시도해 보세요.',
  filename: '파일명만 검색 중입니다. 파일명+본문으로 범위를 넓혀 보세요.',
  content: '본문만 검색 중입니다. 파일명+본문으로 범위를 넓혀 보세요.',
}

const SEARCH_SCOPE_READY: Record<SearchScope, { title: string; description: string }> = {
  filename_content: {
    title: '파일명과 본문을 한 번에 검색',
    description: '먼저 설정에서 대상 폴더를 추가하면 Excel, Word, PPT, PDF 문서 안의 단어까지 검색할 수 있습니다.',
  },
  filename: {
    title: '파일명으로 빠르게 검색',
    description: '파일명만 찾거나 검색 범위를 파일명+본문으로 바꿔 문서 안의 단어까지 검색할 수 있습니다.',
  },
  content: {
    title: '본문만 정밀 검색',
    description: '파일명 일치를 제외하고 Excel, Word, PPT, PDF 문서 본문에서만 검색합니다.',
  },
}

const SEARCH_DEBOUNCE_MS = 600
const INITIAL_SEARCH_FILE_LIMIT = 20
const SEARCH_FILE_LIMIT_STEP = 20
const MAX_SEARCH_FILE_LIMIT = 100
const LANDING_DOCUMENT_PAGE_SIZE = 20

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

type GroupedSearchResult = {
  fileKey: string
  fileName: string
  items: SearchResult[]
  contentHash: string | null
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

function formatInitialDocumentDate(file: FileInfo) {
  if (file.file_mtime) {
    return `수정 ${new Date(file.file_mtime * 1000).toLocaleDateString('ko-KR', { dateStyle: 'medium' })}`
  }
  if (file.created_at) {
    return `등록 ${new Date(file.created_at).toLocaleDateString('ko-KR', { dateStyle: 'medium' })}`
  }
  return '최근 문서'
}

function normalizePathForFilter(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLocaleLowerCase('ko-KR')
}

function getParentFolderPath(filePath: string) {
  const trimmed = filePath.trim()
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slashIndex <= 0) return trimmed
  return trimmed.slice(0, slashIndex)
}

function shortPathLabel(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return path || '대상 폴더'
  return parts[parts.length - 1] ?? path
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

function normalizeDuplicateTitle(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

function getReliableContentHash(items: SearchResult[]) {
  const first = items.find(
    (item) =>
      item.normalized_hash &&
      (item.content_chars ?? 0) > 0 &&
      (item.chunk_count ?? 0) > 0,
  )
  return first?.normalized_hash ?? null
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
      className={`px-4 py-2.5 border-t border-[var(--md-sys-color-outline-variant)] first:border-t-0 hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors ${
        highlightTour ? 'tour-target tour-review-target rounded-xl' : ''
      }`}
      data-tour-target={highlightTour ? 'search-review' : undefined}
    >
      <button
        type="button"
        onClick={() => onOpen(item.file_id, item.name)}
        className="grid w-full gap-2 rounded-md text-left md:grid-cols-[8.5rem_minmax(0,1fr)] md:items-start"
      >
        <p className="type-label-md text-[var(--md-sys-color-primary)] inline-flex items-center gap-1.5">
          <Icon name="my_location" size={14} />
          {item.location}
        </p>
        <div className="min-w-0">
          {tourHint && (
            <span className="tour-evidence-note mb-2">
              <Icon name="check_circle" size={14} />
              {tourHint}
            </span>
          )}
          <SnippetText snippet={item.snippet} />
        </div>
      </button>
    </li>
  )
}

export default function FileSearch({
  active = true,
  tutorialStep,
  libraryDataRevision = 0,
  onTutorialStep,
  onOpenLibrarySettings,
}: {
  active?: boolean
  tutorialStep?: TutorialStep | null
  libraryDataRevision?: number
  onTutorialStep?: (step: TutorialStep | null) => void
  onOpenLibrarySettings?: () => void
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
  const [initialDataLoading, setInitialDataLoading] = useState(false)
  const [initialDataLoadingMore, setInitialDataLoadingMore] = useState(false)
  const [initialFiles, setInitialFiles] = useState<FileInfo[]>([])
  const [initialFileTotal, setInitialFileTotal] = useState(0)
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([])
  const [searchScope, setSearchScope] = useState<SearchScope>('filename_content')
  const [modifiedDateFilter, setModifiedDateFilter] = useState<ModifiedDateFilter>('all')
  const [customModifiedFrom, setCustomModifiedFrom] = useState('')
  const [customModifiedTo, setCustomModifiedTo] = useState('')
  const [excludedFolderPaths, setExcludedFolderPaths] = useState<string[]>([])
  const [expandedContentFiles, setExpandedContentFiles] = useState<Set<string>>(new Set())
  const contentMatchesDefaultExpandedRef = useRef(true)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestSeq = useRef(0)
  const initialDataRequestSeq = useRef(0)
  const watchedFoldersRequestSeq = useRef(0)
  const prefetchedSearchRef = useRef<PrefetchedSearch | null>(null)
  const tutorialSearchAdvanceRef = useRef<string | null>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const landingLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null)

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
    excludedFolders: string[],
  ) =>
    JSON.stringify([
      q.trim(),
      [...fileTypes].sort(),
      scope,
      dateFilter,
      customFrom,
      customTo,
      [...excludedFolders].map(normalizePathForFilter).sort(),
    ])

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
      const nextContentFileKeys = getContentFileKeys(data.results)
      if (!keepExpandedContentFiles || contentMatchesDefaultExpandedRef.current) return nextContentFileKeys

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
      excludedFolders = excludedFolderPaths,
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
        contentMatchesDefaultExpandedRef.current = true
        setLoading(false)
        setLoadingMore(false)
        setPrefetching(false)
        prefetchedSearchRef.current = null
        return false
      }
      const nextFileLimit = Math.min(Math.max(fileLimit, INITIAL_SEARCH_FILE_LIMIT), MAX_SEARCH_FILE_LIMIT)
      const baseKey = searchKey(q, fileTypes, scope, dateFilter, customFrom, customTo, excludedFolders)
      const prefetched = prefetchedSearchRef.current
      if (mode === 'replace') {
        prefetchedSearchRef.current = null
        contentMatchesDefaultExpandedRef.current = true
      }
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
                excluded_folder_paths: excludedFolders.length > 0 ? excludedFolders : undefined,
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
              excluded_folder_paths: excludedFolders.length > 0 ? excludedFolders : undefined,
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
      excludedFolderPaths,
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
    if (expandedContentFiles.has(fileKey)) {
      contentMatchesDefaultExpandedRef.current = false
    }
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

  const addTemporaryExcludedFolder = (filePath: string) => {
    const folderPath = getParentFolderPath(filePath)
    if (!folderPath) return

    let nextFolders = excludedFolderPaths
    const normalized = normalizePathForFilter(folderPath)
    if (!nextFolders.some((path) => normalizePathForFilter(path) === normalized)) {
      nextFolders = [...nextFolders, folderPath]
      setExcludedFolderPaths(nextFolders)
      snackbar.info(`이번 검색에서 "${shortPathLabel(folderPath)}" 폴더를 숨겼습니다.`)
    }
    if (query.trim()) {
      void doSearch(
        query,
        selectedFileTypes,
        searchScope,
        modifiedDateFilter,
        customModifiedFrom,
        customModifiedTo,
        nextFolders,
      )
    }
  }

  const removeTemporaryExcludedFolder = (folderPath: string) => {
    const normalized = normalizePathForFilter(folderPath)
    const nextFolders = excludedFolderPaths.filter((path) => normalizePathForFilter(path) !== normalized)
    setExcludedFolderPaths(nextFolders)
    if (query.trim()) {
      void doSearch(
        query,
        selectedFileTypes,
        searchScope,
        modifiedDateFilter,
        customModifiedFrom,
        customModifiedTo,
        nextFolders,
      )
    }
  }

  useEffect(() => {
    if (!active) return
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
      contentMatchesDefaultExpandedRef.current = true
      return
    }
    void doSearch(query)
  }, [active, libraryDataRevision])

  const loadLandingFiles = useCallback(
    async (offset = 0, mode: 'replace' | 'more' = 'replace') => {
      const requestId = initialDataRequestSeq.current + 1
      initialDataRequestSeq.current = requestId
      if (mode === 'more') {
        setInitialDataLoadingMore(true)
      } else {
        setInitialDataLoading(true)
      }

      try {
        const response = await api.files.page({
          limit: LANDING_DOCUMENT_PAGE_SIZE,
          offset,
          sort: 'file_mtime_desc',
          includeMissing: false,
        })
        if (requestId !== initialDataRequestSeq.current) return
        setInitialFiles((current) =>
          mode === 'more' ? [...current, ...response.data.items] : response.data.items,
        )
        setInitialFileTotal(response.data.total)
      } catch {
        if (requestId !== initialDataRequestSeq.current) return
        if (mode !== 'more') {
          setInitialFiles([])
          setInitialFileTotal(0)
        }
      } finally {
        if (requestId === initialDataRequestSeq.current) {
          setInitialDataLoading(false)
          setInitialDataLoadingMore(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!active) return
    const requestId = watchedFoldersRequestSeq.current + 1
    watchedFoldersRequestSeq.current = requestId
    let cancelled = false

    void api.library
      .getSettings()
      .then((settingsResponse) => {
        if (cancelled || requestId !== watchedFoldersRequestSeq.current) return
        setWatchedFolders(settingsResponse.data.watched_folders)
      })
      .catch(() => {
        if (cancelled || requestId !== watchedFoldersRequestSeq.current) return
        setWatchedFolders(null)
      })

    return () => {
      cancelled = true
    }
  }, [active, libraryDataRevision])

  useEffect(() => {
    if (!active) return
    void loadLandingFiles(0, 'replace')
  }, [active, libraryDataRevision, loadLandingFiles])

  const groupedSearch = useMemo(() => {
    const map = new Map<string, { fileName: string; items: SearchResult[] }>()
    for (const result of results) {
      const fileKey = `${result.file_id}:${result.path}`
      const entry = map.get(fileKey) ?? { fileName: result.name, items: [] }
      entry.items.push(result)
      map.set(fileKey, entry)
    }
    const allGroups: GroupedSearchResult[] = Array.from(map.entries()).map(([fileKey, { fileName, items }]) => ({
      fileKey,
      fileName,
      items,
      contentHash: getReliableContentHash(items),
    }))

    const seenExactTitleContent = new Set<string>()
    let hiddenExactDuplicateCount = 0
    const visibleGroups: GroupedSearchResult[] = []
    for (const group of allGroups) {
      const exactKey = group.contentHash
        ? `${normalizeDuplicateTitle(group.fileName)}:${group.contentHash}`
        : null
      if (exactKey && seenExactTitleContent.has(exactKey)) {
        hiddenExactDuplicateCount += 1
        continue
      }
      if (exactKey) seenExactTitleContent.add(exactKey)
      visibleGroups.push(group)
    }

    return {
      visibleGroups,
      hiddenExactDuplicateCount,
    }
  }, [results])

  const contentFileKeys = useMemo(
    () =>
      groupedSearch.visibleGroups
        .filter((group) => group.items.some((item) => item.location !== '파일명'))
        .map((group) => getContentFileKey(group.items[0])),
    [groupedSearch.visibleGroups],
  )

  const activeModifiedDateLabel = useMemo(
    () =>
      MODIFIED_DATE_FILTERS.find((filter) => filter.value === modifiedDateFilter)?.label ?? '전체',
    [modifiedDateFilter],
  )
  const hasActiveFilters =
    selectedFileTypes.length > 0 ||
    searchScope !== 'filename_content' ||
    modifiedDateFilter !== 'all' ||
    Boolean(customModifiedFrom) ||
    Boolean(customModifiedTo) ||
    excludedFolderPaths.length > 0
  const allContentMatchesExpanded =
    contentFileKeys.length > 0 && contentFileKeys.every((key) => expandedContentFiles.has(key))
  const hasResults = !loading && results.length > 0
  const watchedFolderCount = watchedFolders?.length ?? 0
  const hasWatchedFolders = watchedFolderCount > 0
  const initialFilesHasMore = initialFiles.length < initialFileTotal
  const initialReadyAction = onOpenLibrarySettings
    ? watchedFolders !== null && watchedFolderCount === 0
      ? (
          <Button variant="filled" leadingIcon="drive_folder_upload" onClick={onOpenLibrarySettings}>
            대상 폴더 추가
          </Button>
        )
      : hasWatchedFolders
        ? (
            <Button variant="tonal" leadingIcon="settings" onClick={onOpenLibrarySettings}>
              검색 대상 확인
            </Button>
          )
        : undefined
    : undefined
  const tutorialSearchReviewKey = tutorialStep === 'search-review' ? contentFileKeys[0] : null
  const visibleLocationCount = useMemo(
    () => groupedSearch.visibleGroups.reduce((total, group) => total + group.items.length, 0),
    [groupedSearch.visibleGroups],
  )

  const resetSearchFilters = () => {
    setSelectedFileTypes([])
    setSearchScope('filename_content')
    setModifiedDateFilter('all')
    setCustomModifiedFrom('')
    setCustomModifiedTo('')
    setExcludedFolderPaths([])
    if (query.trim()) {
      void doSearch(query, [], 'filename_content', 'all', '', '', [])
    }
  }

  const expandAllContentMatches = () => {
    contentMatchesDefaultExpandedRef.current = true
    setExpandedContentFiles(new Set(contentFileKeys))
  }

  const collapseAllContentMatches = () => {
    contentMatchesDefaultExpandedRef.current = false
    setExpandedContentFiles(new Set())
  }

  const loadMoreFiles = () => {
    if (!searchMeta.hasMore || loadingMore || loading) return
    if (!query.trim()) return
    const nextLimit = Math.min(searchMeta.fileLimit + SEARCH_FILE_LIMIT_STEP, MAX_SEARCH_FILE_LIMIT)
    void doSearch(
      query,
      selectedFileTypes,
      searchScope,
      modifiedDateFilter,
      customModifiedFrom,
      customModifiedTo,
      excludedFolderPaths,
      nextLimit,
      'more',
    )
  }

  const loadMoreInitialFiles = () => {
    if (!initialFilesHasMore || initialDataLoading || initialDataLoadingMore) return
    void loadLandingFiles(initialFiles.length, 'more')
  }

  useEffect(() => {
    const node = loadMoreSentinelRef.current
    if (!node || !searchMeta.hasMore || loading || loadingMore) return undefined
    if (typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting) return
        loadMoreFiles()
      },
      { rootMargin: '360px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [
    customModifiedFrom,
    customModifiedTo,
    excludedFolderPaths,
    loading,
    loadingMore,
    modifiedDateFilter,
    query,
    searchMeta.fileLimit,
    searchMeta.hasMore,
    searchScope,
    selectedFileTypes,
  ])

  useEffect(() => {
    const node = landingLoadMoreSentinelRef.current
    if (!node || !initialFilesHasMore || initialDataLoading || initialDataLoadingMore || query.trim()) {
      return undefined
    }
    if (typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting) return
        loadMoreInitialFiles()
      },
      { rootMargin: '360px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [
    initialDataLoading,
    initialDataLoadingMore,
    initialFiles.length,
    initialFilesHasMore,
    query,
    loadLandingFiles,
  ])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      searchRequestSeq.current += 1
    }
  }, [])

  useEffect(() => {
    if (tutorialStep !== 'search') {
      tutorialSearchAdvanceRef.current = null
      return undefined
    }
    if (!searched || loading || results.length === 0) return undefined
    if (!query.trim().includes(EXAMPLE_SEARCH_QUERY)) return undefined
    const advanceKey = `${query.trim()}:${results.length}:${contentFileKeys.length}`
    if (tutorialSearchAdvanceRef.current === advanceKey) return undefined
    tutorialSearchAdvanceRef.current = advanceKey
    const timer = window.setTimeout(() => onTutorialStep?.('search-review'), 1400)
    return () => window.clearTimeout(timer)
  }, [contentFileKeys.length, loading, onTutorialStep, query, results.length, searched, tutorialStep])

  return (
    <div className="space-y-6">
      <Card variant="elevated" className="console-panel p-4 md:p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="flex-1">
            <div
              className={tutorialStep === 'search' ? 'attention-pulse tour-target rounded-xl' : undefined}
              data-tour-target={tutorialStep === 'search' ? 'search' : undefined}
            >
              <TextField
                leadingIcon="search"
                placeholder={tutorialStep === 'search' ? `따라 쓰세요: ${EXAMPLE_SEARCH_QUERY}` : '파일 안의 단어를 검색 (예: 일정, 예산안, 실험 결과)'}
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                className="h-11 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] pr-11 text-[1rem] shadow-[0_1px_0_var(--ow-inset-highlight)_inset,0_0_0_1px_color-mix(in_srgb,var(--md-sys-color-outline-variant)_55%,transparent)]"
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
                        setExcludedFolderPaths([])
                        setExpandedContentFiles(new Set())
                        contentMatchesDefaultExpandedRef.current = true
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
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="filled"
              leadingIcon="search"
              onClick={() => {
                void doSearch(query, selectedFileTypes, searchScope).then((hasResults) => {
                  if (tutorialStep !== 'search') return
                  if (hasResults) {
                    onTutorialStep?.('search-review')
                  } else {
                    snackbar.warn('예제 검색 결과가 아직 없습니다. 문서 새로고침 완료 후 다시 검색해 주세요.')
                  }
                })
              }}
              disabled={!query.trim() || loading}
            >
              검색
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="bolt" size={16} /> {SEARCH_SCOPE_STATUS[searchScope]}
          </span>
          {tutorialStep === 'search' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--md-sys-color-primary)]/20 bg-[var(--md-sys-color-primary-container)]/55 px-3 py-1 text-[var(--md-sys-color-on-primary-container)]">
              <Icon name="visibility" size={16} />
              <span className="inline-flex items-center gap-1.5">
                <kbd className="rounded-md border border-[var(--md-sys-color-primary)]/25 bg-[var(--md-sys-color-surface-container-lowest)] px-1.5 py-0.5 font-mono text-[0.78rem]">
                  {EXAMPLE_SEARCH_QUERY}
                </kbd>
                입력 후 자동으로 검색됩니다
              </span>
            </span>
          )}
        </div>

        <div className="surface-summary flex flex-col gap-2.5 rounded-lg p-2.5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
              <Icon name="folder_open" size={18} />
            </span>
            <div className="min-w-0">
              <p className="type-label-lg text-[var(--md-sys-color-on-surface)]">
                {watchedFolders === null
                  ? '검색 대상 확인 중'
                  : watchedFolderCount > 0
                    ? `검색 대상 ${watchedFolderCount}개 폴더`
                    : '검색 대상 폴더 없음'}
              </p>
              <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                {watchedFolders === null ? (
                  <span className="inline-flex items-center gap-1.5 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    <Spinner size={14} />
                    설정을 읽는 중
                  </span>
                ) : watchedFolderCount === 0 ? (
                  <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    설정에서 대상 폴더를 추가하면 바로 검색할 수 있습니다.
                  </span>
                ) : (
                  <>
                    {watchedFolders.slice(0, 3).map((folder) => (
                      <Chip
                        key={folder.path}
                        label={folder.path}
                        tone="secondary"
                        as="span"
                        icon={folder.recursive ? 'account_tree' : 'folder'}
                        className="max-w-full truncate"
                      />
                    ))}
                    {watchedFolderCount > 3 && (
                      <Chip label={`+${watchedFolderCount - 3}개`} tone="neutral" as="span" />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          {onOpenLibrarySettings && (
            <Button variant="text" size="sm" leadingIcon="settings" onClick={onOpenLibrarySettings}>
              대상 관리
            </Button>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.55fr)]">
          <div className="console-subpanel rounded-lg p-3 space-y-2">
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
          <div className="console-subpanel rounded-lg p-3">
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
          <div className="console-subpanel rounded-lg p-3 space-y-1.5 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">수정일</span>
              <Button
                variant="text"
                size="sm"
                leadingIcon="filter_alt_off"
                onClick={resetSearchFilters}
                disabled={!hasActiveFilters}
              >
                필터 지우기
              </Button>
            </div>
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
            {hasActiveFilters && (
              <div className="flex items-center gap-2 flex-wrap pt-1 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                <Icon name="filter_alt" size={16} />
                <span>현재 필터:</span>
                {searchScope !== 'filename_content' && (
                  <Chip label={SEARCH_SCOPE_STATUS[searchScope]} tone="secondary" as="span" />
                )}
                {selectedFileTypes.map((fileType) => (
                  <Chip key={fileType} label={`.${fileType}`} tone="secondary" as="span" />
                ))}
                {modifiedDateFilter !== 'all' && (
                  <Chip label={activeModifiedDateLabel} tone="secondary" as="span" />
                )}
                {excludedFolderPaths.map((folderPath) => (
                  <Chip
                    key={folderPath}
                    label={`숨김: ${shortPathLabel(folderPath)}`}
                    tone="secondary"
                    as="span"
                    icon="visibility_off"
                    onRemove={() => removeTemporaryExcludedFolder(folderPath)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

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
          action={
            onOpenLibrarySettings ? (
              <Button variant="tonal" leadingIcon="settings" onClick={onOpenLibrarySettings}>
                검색 대상 확인
              </Button>
            ) : undefined
          }
        />
      )}

      {!loading && !searched && !query && initialFiles.length > 0 && (
        <Card variant="outlined" className="console-panel p-4 md:p-5 space-y-4 shadow-none ring-1 ring-[var(--ow-inset-highlight)]">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="type-title-md text-[var(--md-sys-color-on-surface)]">전체 문서</p>
              <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                검색 준비된 문서를 최근 수정된 순서로 보여줍니다 · {initialFiles.length.toLocaleString('ko-KR')}개 표시
                {initialFileTotal > initialFiles.length ? ` / 전체 ${initialFileTotal.toLocaleString('ko-KR')}개` : ''}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {(initialDataLoading || initialDataLoadingMore) && (
                <span className="inline-flex items-center gap-1.5 type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                  <Spinner size={16} />
                  확인 중
                </span>
              )}
              {initialReadyAction}
            </div>
          </div>
          <div className="space-y-2">
            {initialFiles.map((file) => (
              <div
                key={file.id}
                className="rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 transition-colors hover:bg-[var(--md-sys-color-surface-container-low)]"
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0 flex items-start gap-2.5">
                    <FileTypeBadge fileType={file.file_type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate type-title-sm text-[var(--md-sys-color-on-surface)]" title={file.name}>
                        {file.name}
                      </p>
                      <p className="mt-1 truncate type-body-sm text-[var(--md-sys-color-on-surface-variant)]" title={file.path}>
                        {file.path}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:justify-end">
                    <span className="whitespace-nowrap type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                      {formatInitialDocumentDate(file)}
                    </span>
                    <Button
                      variant="text"
                      size="sm"
                      leadingIcon="open_in_new"
                      onClick={() => handleOpenFile(file.id, file.name)}
                    >
                      열기
                    </Button>
                    <Button
                      variant="text"
                      size="sm"
                      leadingIcon="folder_open"
                      onClick={() => handleShowInFolder(file.id, file.name, file.path)}
                    >
                      폴더
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {initialFilesHasMore && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <div ref={landingLoadMoreSentinelRef} className="h-2 w-full" aria-hidden="true" />
              <Button
                variant="tonal"
                leadingIcon="expand_more"
                onClick={loadMoreInitialFiles}
                loading={initialDataLoadingMore}
                disabled={initialDataLoading || initialDataLoadingMore}
              >
                더 보기 · 스크롤해도 자동으로 불러옵니다
              </Button>
            </div>
          )}
        </Card>
      )}

      {!loading && !searched && !query && initialFiles.length === 0 && initialDataLoading && (
        <div className="flex items-center justify-center gap-3 py-16 type-body-md text-[var(--md-sys-color-on-surface-variant)]">
          <Spinner size={20} />
          <span>검색 준비 상태를 확인하는 중…</span>
        </div>
      )}

      {!loading && !searched && !query && initialFiles.length === 0 && !initialDataLoading && (
        <EmptyState
          icon={hasWatchedFolders ? 'folder_open' : 'manage_search'}
          title={hasWatchedFolders ? '대상 폴더가 등록되어 있습니다' : SEARCH_SCOPE_READY[searchScope].title}
          description={
            hasWatchedFolders
              ? '문서 새로고침을 실행하면 검색 창에 전체 문서가 최근 수정된 순서로 표시됩니다.'
              : SEARCH_SCOPE_READY[searchScope].description
          }
          action={initialReadyAction}
        />
      )}

      {hasResults && (
        <div className="space-y-3">
          <div className="surface-summary flex items-center gap-2 flex-wrap rounded-lg p-3">
            <Chip label={`${groupedSearch.visibleGroups.length}개 파일`} tone="primary" as="span" icon="folder_open" />
            <Chip label={`${visibleLocationCount}개 위치`} tone="neutral" as="span" icon="filter_list" />
            {selectedFileTypes.length > 0 && (
              <Chip label={`형식 ${selectedFileTypes.length}개 선택`} tone="secondary" as="span" icon="checklist" />
            )}
            {modifiedDateFilter !== 'all' && (
              <Chip label={`수정일 ${activeModifiedDateLabel}`} tone="secondary" as="span" icon="event" />
            )}
            {excludedFolderPaths.length > 0 && (
              <Chip label={`임시 숨김 ${excludedFolderPaths.length}개`} tone="secondary" as="span" icon="visibility_off" />
            )}
            <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              파일별로 묶어서 보여줍니다
              {prefetching ? ' · 다음 결과 준비 중' : ''}
            </span>
            <div className="ml-auto flex gap-2 flex-wrap">
              {groupedSearch.hiddenExactDuplicateCount > 0 && (
                <Chip
                  label={`같은 이름·같은 내용 ${groupedSearch.hiddenExactDuplicateCount}개 숨김`}
                  tone="neutral"
                  as="span"
                  icon="content_copy"
                />
              )}
              {contentFileKeys.length > 0 && (
                <>
                  <Button
                    variant="text"
                    size="sm"
                    leadingIcon="unfold_more"
                    onClick={expandAllContentMatches}
                    disabled={allContentMatchesExpanded}
                  >
                    본문 위치 펼치기
                  </Button>
                  <Button
                    variant="text"
                    size="sm"
                    leadingIcon="unfold_less"
                    onClick={collapseAllContentMatches}
                    disabled={expandedContentFiles.size === 0}
                  >
                    본문 위치 접기
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="space-y-3">
            {groupedSearch.visibleGroups.map((group) => {
              const { fileName, items } = group
              const fileKey = getContentFileKey(items[0])
              const filenameItems = items.filter((item) => item.location === '파일명')
              const contentItems = items.filter((item) => item.location !== '파일명')
              const contentExpanded = expandedContentFiles.has(fileKey)
              const firstContentItem = contentItems[0]
              const titleSnippet = filenameItems[0]?.snippet ?? fileName

              return (
                <Card key={group.fileKey} variant="outlined" className="overflow-hidden console-panel shadow-none ring-1 ring-[var(--ow-inset-highlight)]">
                  <header className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]/72 px-4 py-3">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FileTypeBadge fileType={items[0].file_type} />
                          <span className="min-w-0 flex-1 truncate type-title-sm text-[var(--md-sys-color-on-surface)]">
                            <HighlightedSnippet
                              snippet={titleSnippet}
                              className="type-title-sm text-[var(--md-sys-color-on-surface)]"
                            />
                          </span>
                          <Badge tone="neutral">{items.length}건</Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2 truncate type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                          <Icon name="description" size={15} />
                          <span className="truncate" title={items[0].path}>{items[0].path}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {contentItems.length > 0 && (
                          <Button
                            variant="tonal"
                            size="sm"
                            leadingIcon={contentExpanded ? 'expand_less' : 'subject'}
                            onClick={() => toggleContentMatches(fileKey)}
                          >
                            {contentExpanded ? '본문 위치 접기' : `본문 위치 ${contentItems.length}건`}
                          </Button>
                        )}
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
                          폴더
                        </Button>
                        <Button
                          variant="text"
                          size="sm"
                          leadingIcon="visibility_off"
                          onClick={() => addTemporaryExcludedFolder(items[0].path)}
                          title="이번 검색에서 이 파일이 있는 폴더의 결과를 숨깁니다."
                        >
                          이번 검색 제외
                        </Button>
                      </div>
                    </div>
                    {firstContentItem && !contentExpanded && (
                      <button
                        type="button"
                        onClick={() => toggleContentMatches(fileKey)}
                        className="mt-3 grid w-full gap-2 rounded-lg border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2 text-left transition-colors hover:border-[var(--md-sys-color-primary)] hover:bg-[var(--md-sys-color-surface-container-low)] md:grid-cols-[8.5rem_minmax(0,1fr)]"
                      >
                        <span className="inline-flex items-center gap-1.5 type-label-md text-[var(--md-sys-color-primary)]">
                          <Icon name="subject" size={14} />
                          본문 미리보기
                        </span>
                        <HighlightedSnippet
                          snippet={firstContentItem.snippet}
                          className="line-clamp-2 type-body-sm text-[var(--md-sys-color-on-surface)]"
                        />
                      </button>
                    )}
                  </header>
                  <ul>
                    {contentExpanded &&
                      contentItems.map((item, index) => (
                        <SearchResultListItem
                          key={`content-${item.file_id}-${item.location}-${index}`}
                          item={item}
                          onOpen={handleOpenFile}
                          highlightTour={fileKey === tutorialSearchReviewKey && index === 0}
                          tourHint={
                            fileKey === tutorialSearchReviewKey && index === 0
                              ? `본문에서 “${EXAMPLE_SEARCH_QUERY}”을 찾았습니다`
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
            <div className="flex flex-col items-center gap-2 pt-2">
              <div ref={loadMoreSentinelRef} className="h-2 w-full" aria-hidden="true" />
              <Button
                variant="tonal"
                leadingIcon="expand_more"
                onClick={loadMoreFiles}
                loading={loadingMore}
                disabled={loadingMore || loading}
              >
                더 보기 · 스크롤해도 자동으로 불러옵니다
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
