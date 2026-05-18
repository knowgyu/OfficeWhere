import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { api, getOfficeWhereBridge, type QuickSearchSettings, type SearchResult } from '../api/client'
import { Button, FileTypeBadge, Icon } from '../ui'

const SEARCH_DEBOUNCE_MS = 140
const SEARCH_LIMIT = 36
const SEARCH_FILE_LIMIT = 10

type PaletteDocument = {
  fileId: number
  name: string
  path: string
  fileType: string
  locations: string[]
  snippets: SearchResult[]
}

type ActiveSearchFilter = {
  key: string
  label: string
}

type ParsedQuickSearchQuery = {
  query: string
  fileTypes: string[]
  searchScope: 'filename_content' | 'filename' | 'content'
  filters: ActiveSearchFilter[]
}

type PaletteAction = {
  id: string
  icon: string
  title: string
  description: string
  shortcut: string
  run: () => void | Promise<void>
}

const DEFAULT_QUICK_SEARCH_SETTINGS: QuickSearchSettings = {
  supported: false,
  enabled: false,
  showRecent: false,
  accelerator: 'CommandOrControl+Alt+F',
  displayShortcut: 'Ctrl + Alt + F',
  registered: false,
  reason: '데스크톱 앱에서만 빠른 검색을 사용할 수 있습니다.',
}

const SCOPE_PREFIXES: Record<string, { scope: ParsedQuickSearchQuery['searchScope']; label: string }> = {
  f: { scope: 'filename', label: '파일명' },
  file: { scope: 'filename', label: '파일명' },
  filename: { scope: 'filename', label: '파일명' },
  name: { scope: 'filename', label: '파일명' },
  파일: { scope: 'filename', label: '파일명' },
  파일명: { scope: 'filename', label: '파일명' },
  c: { scope: 'content', label: '본문' },
  content: { scope: 'content', label: '본문' },
  body: { scope: 'content', label: '본문' },
  text: { scope: 'content', label: '본문' },
  본문: { scope: 'content', label: '본문' },
  내용: { scope: 'content', label: '본문' },
  all: { scope: 'filename_content', label: '전체' },
  전체: { scope: 'filename_content', label: '전체' },
}

const FILE_TYPE_PREFIXES: Record<string, { fileType: string; label: string }> = {
  pdf: { fileType: 'PDF', label: 'PDF' },
  word: { fileType: 'Word', label: 'Word' },
  doc: { fileType: 'Word', label: 'Word' },
  docx: { fileType: 'Word', label: 'Word' },
  워드: { fileType: 'Word', label: 'Word' },
  excel: { fileType: 'Excel', label: 'Excel' },
  xls: { fileType: 'Excel', label: 'Excel' },
  xlsx: { fileType: 'Excel', label: 'Excel' },
  엑셀: { fileType: 'Excel', label: 'Excel' },
  ppt: { fileType: 'PowerPoint', label: 'PPT' },
  pptx: { fileType: 'PowerPoint', label: 'PPT' },
  powerpoint: { fileType: 'PowerPoint', label: 'PPT' },
  파워포인트: { fileType: 'PowerPoint', label: 'PPT' },
  피피티: { fileType: 'PowerPoint', label: 'PPT' },
}

function parseQuickSearchQuery(value: string): ParsedQuickSearchQuery {
  let remaining = value.trimStart()
  let searchScope: ParsedQuickSearchQuery['searchScope'] = 'filename_content'
  let scopeFilter: ActiveSearchFilter | null = null
  const fileTypes: string[] = []
  const fileTypeFilters: ActiveSearchFilter[] = []

  while (remaining) {
    const match = remaining.match(/^([^\s:]+)(?::|\s+)/)
    if (!match) break

    const rawToken = match[1]
    const token = rawToken.trim().toLowerCase()
    const scopePrefix = SCOPE_PREFIXES[token]
    const fileTypePrefix = FILE_TYPE_PREFIXES[token]
    if (!scopePrefix && !fileTypePrefix) break

    if (scopePrefix) {
      searchScope = scopePrefix.scope
      scopeFilter = scopePrefix.scope === 'filename_content' ? null : { key: `scope:${scopePrefix.scope}`, label: scopePrefix.label }
    }

    if (fileTypePrefix && !fileTypes.includes(fileTypePrefix.fileType)) {
      fileTypes.push(fileTypePrefix.fileType)
      fileTypeFilters.push({ key: `type:${fileTypePrefix.fileType}`, label: fileTypePrefix.label })
    }

    remaining = remaining.slice(match[0].length).trimStart()
  }

  return {
    query: remaining.trim(),
    fileTypes,
    searchScope,
    filters: [...(scopeFilter ? [scopeFilter] : []), ...fileTypeFilters],
  }
}

function fileIcon(fileType: string) {
  const normalized = fileType.toLowerCase()
  if (normalized.includes('excel') || normalized.includes('xlsx')) return 'table_chart'
  if (normalized.includes('word') || normalized.includes('docx')) return 'article'
  if (normalized.includes('powerpoint') || normalized.includes('ppt')) return 'slideshow'
  if (normalized.includes('pdf')) return 'picture_as_pdf'
  if (normalized.includes('markdown')) return 'notes'
  return 'description'
}

function shortFolder(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 1) return path || '위치 정보 없음'
  return parts.slice(Math.max(0, parts.length - 3), -1).join(' / ') || parts[parts.length - 2] || path
}

function highlightedParts(snippet: string) {
  return snippet.split('**').map((part, index) =>
    index % 2 === 1 ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-[0.32rem] bg-[var(--md-sys-color-tertiary-container)] px-1 py-[1px] text-[var(--md-sys-color-on-tertiary-container)]"
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  )
}

function groupResults(results: SearchResult[]): PaletteDocument[] {
  const map = new Map<number, PaletteDocument>()
  results.forEach((result) => {
    const current =
      map.get(result.file_id) ??
      ({
        fileId: result.file_id,
        name: result.name,
        path: result.path,
        fileType: result.file_type,
        locations: [],
        snippets: [],
      } satisfies PaletteDocument)
    if (!current.locations.includes(result.location)) current.locations.push(result.location)
    current.snippets.push(result)
    map.set(result.file_id, current)
  })
  return [...map.values()]
}

export default function QuickSearchPalette() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectedResultRef = useRef<HTMLLIElement | null>(null)
  const actionPanelOpenRef = useRef(false)
  const requestSeq = useRef(0)
  const [query, setQuery] = useState('')
  const [documents, setDocuments] = useState<PaletteDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expandedFileId, setExpandedFileId] = useState<number | null>(null)
  const [actionPanelOpen, setActionPanelOpen] = useState(false)
  const [selectedActionIndex, setSelectedActionIndex] = useState(0)
  const [settings, setSettings] = useState<QuickSearchSettings>(DEFAULT_QUICK_SEARCH_SETTINGS)

  const parsedQuery = useMemo(() => parseQuickSearchQuery(query), [query])
  const trimmedQuery = parsedQuery.query
  const selectedDocument = documents[selectedIndex] ?? null
  const compactIdle = !trimmedQuery

  const closePalette = useCallback(() => {
    void api.app.hideQuickSearch()
  }, [])

  const revealInFolder = useCallback(
    async (document: PaletteDocument | null = selectedDocument) => {
      if (!document) return
      await api.files.showInFolder(document.fileId, document.path)
      closePalette()
    },
    [closePalette, selectedDocument],
  )

  const openOriginalFile = useCallback(
    async (document: PaletteDocument | null = selectedDocument) => {
      if (!document) return
      await api.files.open(document.fileId)
      closePalette()
    },
    [closePalette, selectedDocument],
  )

  const copyDocumentPath = useCallback(
    async (document: PaletteDocument | null = selectedDocument) => {
      if (!document) return
      try {
        await navigator.clipboard?.writeText(document.path)
      } catch {
        // Clipboard access can be denied by the OS; keep the action best-effort.
      }
      setActionPanelOpen(false)
    },
    [selectedDocument],
  )

  const openInMainSearch = useCallback(() => {
    void api.app.openMainSearch(trimmedQuery)
  }, [trimmedQuery])

  const paletteActions = useMemo<PaletteAction[]>(() => {
    if (!selectedDocument) return []
    const detailsOpen = expandedFileId === selectedDocument.fileId
    return [
      {
        id: 'toggle-details',
        icon: 'subject',
        title: detailsOpen ? '상세 닫기' : '상세 보기',
        description: '일치 위치와 본문 조각을 확인합니다.',
        shortcut: 'Enter',
        run: () => {
          setExpandedFileId((current) => (current === selectedDocument.fileId ? null : selectedDocument.fileId))
          setActionPanelOpen(false)
        },
      },
      {
        id: 'open-file',
        icon: 'open_in_new',
        title: '파일 열기',
        description: '원본 문서를 기본 앱으로 엽니다.',
        shortcut: 'Shift Enter',
        run: () => openOriginalFile(selectedDocument),
      },
      {
        id: 'reveal-folder',
        icon: 'folder_open',
        title: '위치 열기',
        description: '탐색기에서 파일 위치를 엽니다.',
        shortcut: 'Ctrl/Cmd Enter',
        run: () => revealInFolder(selectedDocument),
      },
      {
        id: 'copy-path',
        icon: 'content_copy',
        title: '경로 복사',
        description: '파일 전체 경로를 클립보드에 복사합니다.',
        shortcut: 'Ctrl/Cmd C',
        run: () => copyDocumentPath(selectedDocument),
      },
      {
        id: 'open-main-search',
        icon: 'search',
        title: '검색 탭에서 보기',
        description: '현재 검색어를 메인 검색 화면으로 보냅니다.',
        shortcut: 'Ctrl/Cmd O',
        run: openInMainSearch,
      },
    ]
  }, [copyDocumentPath, expandedFileId, openInMainSearch, openOriginalFile, revealInFolder, selectedDocument])

  const runPaletteAction = useCallback((action: PaletteAction | undefined) => {
    if (!action) return
    void action.run()
  }, [])

  const applyQuickSearchSettings = useCallback((nextSettings?: Partial<QuickSearchSettings>) => {
    if (!nextSettings) return
    setSettings((current) => ({ ...current, ...nextSettings }))
  }, [])

  const prepareHiddenPalette = useCallback(
    (nextSettings?: Partial<QuickSearchSettings>) => {
      applyQuickSearchSettings(nextSettings)
      requestSeq.current += 1
      setQuery('')
      setDocuments([])
      setLoading(false)
      setSearched(false)
      setError('')
      setSelectedIndex(0)
      setExpandedFileId(null)
      setActionPanelOpen(false)
      setSelectedActionIndex(0)
    },
    [applyQuickSearchSettings],
  )

  const focusPaletteInput = useCallback(() => {
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.window = 'quick-search'
    return () => {
      delete document.documentElement.dataset.window
    }
  }, [])

  useEffect(() => {
    void api.app.getQuickSearchSettings().then((response) => setSettings(response.data))
    const bridge = getOfficeWhereBridge()
    const unsubscribeOpened = bridge?.onQuickSearchOpened?.((payload) => {
      applyQuickSearchSettings(payload)
      focusPaletteInput()
    })
    const unsubscribePrepare = bridge?.onQuickSearchPrepare?.((payload) => {
      prepareHiddenPalette(payload)
    })
    const unsubscribeSettings = bridge?.onQuickSearchSettingsChanged?.((payload) => {
      applyQuickSearchSettings(payload)
    })
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      unsubscribeOpened?.()
      unsubscribePrepare?.()
      unsubscribeSettings?.()
    }
  }, [applyQuickSearchSettings, focusPaletteInput, prepareHiddenPalette])

  useEffect(() => {
    actionPanelOpenRef.current = actionPanelOpen
  }, [actionPanelOpen])

  useEffect(() => {
    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (actionPanelOpenRef.current) {
        setActionPanelOpen(false)
        return
      }
      closePalette()
    }
    window.addEventListener('keydown', onGlobalKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onGlobalKeyDown, { capture: true })
  }, [closePalette])

  useEffect(() => {
    if (!trimmedQuery || documents.length === 0) return
    selectedResultRef.current?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [documents.length, expandedFileId, selectedIndex, trimmedQuery])

  useEffect(() => {
    const requestId = requestSeq.current + 1
    requestSeq.current = requestId

    if (!trimmedQuery) {
      setDocuments([])
      setSearched(false)
      setLoading(false)
      setError('')
      setSelectedIndex(0)
      setExpandedFileId(null)
      setActionPanelOpen(false)
      return undefined
    }

    setLoading(true)
    setError('')
    const timer = window.setTimeout(() => {
      void api.search
        .query({
          query: trimmedQuery,
          limit: SEARCH_LIMIT,
          file_limit: SEARCH_FILE_LIMIT,
          file_types: parsedQuery.fileTypes,
          search_scope: parsedQuery.searchScope,
        })
        .then((response) => {
          if (requestSeq.current !== requestId) return
          const grouped = groupResults(response.data.results)
          setDocuments(grouped)
          setSelectedIndex(0)
          setExpandedFileId(null)
          setActionPanelOpen(false)
          setSearched(true)
        })
        .catch(() => {
          if (requestSeq.current !== requestId) return
          setDocuments([])
          setSearched(true)
          setError('검색 준비 데이터에 연결하지 못했습니다. OfficeWhere가 문서를 새로고침 중인지 확인해 주세요.')
        })
        .finally(() => {
          if (requestSeq.current === requestId) setLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [parsedQuery.fileTypes, parsedQuery.searchScope, trimmedQuery])

  useEffect(() => {
    if (selectedActionIndex >= paletteActions.length) {
      setSelectedActionIndex(Math.max(0, paletteActions.length - 1))
    }
  }, [paletteActions.length, selectedActionIndex])

  useEffect(() => {
    if (!selectedDocument) {
      setActionPanelOpen(false)
      setSelectedActionIndex(0)
    }
  }, [selectedDocument])

  const statusText = useMemo(() => {
    if (loading) return '검색 중'
    if (error) return '검색 실패'
    if (!searched) return '입력 대기'
    return `${documents.length}개 문서`
  }, [documents.length, error, loading, searched])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      if (paletteActions.length === 0) return
      setSelectedActionIndex(0)
      setActionPanelOpen((current) => !current)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      if (actionPanelOpen) {
        setActionPanelOpen(false)
        return
      }
      closePalette()
      return
    }

    if (actionPanelOpen) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        runPaletteAction(paletteActions.find((action) => action.id === 'reveal-folder'))
        return
      }

      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        runPaletteAction(paletteActions.find((action) => action.id === 'open-file'))
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        runPaletteAction(paletteActions.find((action) => action.id === 'copy-path'))
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        runPaletteAction(paletteActions.find((action) => action.id === 'open-main-search'))
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedActionIndex((value) => Math.min(value + 1, Math.max(0, paletteActions.length - 1)))
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedActionIndex((value) => Math.max(0, value - 1))
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        runPaletteAction(paletteActions[selectedActionIndex])
        return
      }
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((value) => Math.min(value + 1, Math.max(0, documents.length - 1)))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((value) => Math.max(0, value - 1))
      return
    }

    if (event.key !== 'Enter' || documents.length === 0) return
    event.preventDefault()
    if (event.metaKey || event.ctrlKey) {
      void revealInFolder()
      return
    }
    if (event.shiftKey) {
      void openOriginalFile()
      return
    }
    const fileId = selectedDocument?.fileId ?? null
    setExpandedFileId((current) => (current === fileId ? null : fileId))
  }

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-transparent px-2.5 py-2.5 text-[var(--md-sys-color-on-surface)]"
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closePalette()
      }}
    >
      <section
        className={`quick-search-shell relative flex flex-col overflow-hidden rounded-[1.25rem] border border-[color-mix(in_srgb,var(--md-sys-color-outline-variant)_80%,transparent)] bg-[color-mix(in_srgb,var(--md-sys-color-surface-container-lowest)_96%,transparent)] shadow-[0_1px_0_var(--ow-inset-highlight)_inset] backdrop-blur-2xl ${
          trimmedQuery ? 'h-full' : 'h-auto'
        }`}
      >
        <header
          className={`bg-[color-mix(in_srgb,var(--md-sys-color-surface-container-low)_78%,transparent)] px-4 py-2.5 ${
            compactIdle ? '' : 'border-b border-[var(--md-sys-color-outline-variant)]/80'
          }`}
        >
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="문서, 파일명, 본문 검색..."
              className="h-11 min-w-0 flex-1 bg-transparent text-[1.28rem] font-semibold tracking-[-0.025em] text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)]"
              aria-label="빠른 문서 검색"
            />
            {trimmedQuery && (
              <div className="hidden items-center gap-1 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2.5 py-1 type-label-md text-[var(--md-sys-color-on-surface-variant)] sm:flex">
                <Icon name="keyboard" size={14} />
                {settings.displayShortcut}
              </div>
            )}
          </div>
          {trimmedQuery && (
            <div className="mt-2 flex items-center justify-between gap-3 px-1 type-label-md text-[var(--md-sys-color-on-surface-variant)]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--md-sys-color-primary)]" />
                <span className="shrink-0">{statusText}</span>
                {parsedQuery.filters.map((filter) => (
                  <span
                    key={filter.key}
                    className="rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2 py-0.5 text-[var(--md-sys-color-primary)]"
                  >
                    {filter.label}
                  </span>
                ))}
              </span>
              <span>↑↓ 이동 · Enter 상세 · Ctrl/Cmd Enter 위치 · Shift Enter 열기</span>
            </div>
          )}
        </header>

        {!compactIdle && (
          <div className={trimmedQuery ? 'min-h-0 flex-1 overflow-y-auto p-3' : 'p-3'}>
            {trimmedQuery && error && (
              <div className="m-4 rounded-2xl border border-[var(--md-sys-color-error)] bg-[var(--md-sys-color-error-container)] p-4 text-[var(--md-sys-color-on-error-container)]">
                <p className="type-title-sm">검색할 수 없습니다</p>
                <p className="mt-1 type-body-sm">{error}</p>
              </div>
            )}

            {trimmedQuery && !error && searched && documents.length === 0 && !loading && (
              <div className="grid h-full place-items-center px-6 py-8 text-center">
                <div className="max-w-md space-y-3">
                  <Icon name="search_off" size={34} className="mx-auto text-[var(--md-sys-color-on-surface-variant)]" />
                  <p className="type-title-md">결과가 없습니다</p>
                  <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
                    검색어를 줄이거나 설정에서 문서 폴더와 새로고침 상태를 확인해 주세요.
                  </p>
                </div>
              </div>
            )}

            {trimmedQuery && documents.length > 0 && (
              <ul className="space-y-1.5" role="listbox" aria-label="빠른 검색 결과">
                {documents.map((document, index) => {
                  const selected = index === selectedIndex
                  const expanded = expandedFileId === document.fileId
                  return (
                    <li key={document.fileId} ref={selected ? selectedResultRef : undefined}>
                      <div
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`group relative flex items-center gap-2 rounded-2xl border p-2.5 transition-all ${
                          selected
                            ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/34 shadow-elev-2'
                            : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                        }`}
                        role="option"
                        aria-selected={selected}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedIndex(index)}
                          className="state-host relative min-w-0 flex-1 rounded-xl text-left outline-none"
                          aria-label={`${document.name} 선택`}
                        >
                          <span className="state-layer rounded-xl" />
                          <span className="relative flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-primary)] shadow-[0_1px_0_var(--ow-inset-highlight)_inset]">
                              <Icon name={fileIcon(document.fileType)} size={21} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate type-title-sm text-[var(--md-sys-color-on-surface)]">
                                  {document.name}
                                </span>
                                <FileTypeBadge fileType={document.fileType} />
                              </span>
                              <span className="mt-0.5 block truncate type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                                {shortFolder(document.path)}
                              </span>
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedIndex(index)
                            setExpandedFileId((current) => (current === document.fileId ? null : document.fileId))
                          }}
                          className="state-host relative inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-2.5 type-label-md text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-color-surface-container-high)]"
                          aria-expanded={expanded}
                          aria-label={`${document.name} 상세 ${expanded ? '닫기' : '보기'}`}
                        >
                          <span className="state-layer rounded-full" />
                          <span className="relative hidden sm:inline">상세</span>
                          <Icon name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} className="relative" />
                        </button>
                      </div>

                      {expanded && (
                        <div className="mx-2 -mt-1 rounded-b-2xl border-x border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 shadow-[0_1px_0_var(--ow-inset-highlight)_inset]">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="type-label-md text-[var(--md-sys-color-primary)]">
                                {document.snippets.length}개 일치 · {document.locations.slice(0, 2).join(', ')}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-[0.72rem] text-[var(--md-sys-color-on-surface-variant)]">
                                {document.path}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={() => void openOriginalFile(document)}>
                                파일 열기
                              </Button>
                              <Button variant="outlined" size="sm" leadingIcon="folder_open" onClick={() => void revealInFolder(document)}>
                                위치 열기
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {document.snippets.slice(0, 4).map((snippet, snippetIndex) => (
                              <div
                                key={`${snippet.location}-${snippetIndex}`}
                                className="rounded-xl bg-[var(--md-sys-color-surface-container-low)] px-3 py-2"
                              >
                                <p className="mb-1 inline-flex items-center gap-1.5 type-label-md text-[var(--md-sys-color-primary)]">
                                  <Icon name="my_location" size={14} />
                                  {snippet.location}
                                </p>
                                <p className="type-body-sm text-[var(--md-sys-color-on-surface)]">
                                  {highlightedParts(snippet.snippet)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {trimmedQuery && (
          <>
            {actionPanelOpen && selectedDocument && (
              <div
                role="dialog"
                aria-label="문서 작업"
                className="absolute bottom-[3.9rem] right-4 z-20 w-[min(25rem,calc(100%-2rem))] overflow-hidden rounded-2xl border border-[var(--md-sys-color-outline-variant)] bg-[color-mix(in_srgb,var(--md-sys-color-surface-container-lowest)_98%,transparent)] shadow-[0_10px_24px_rgba(0,0,0,0.18),0_1px_0_var(--ow-inset-highlight)_inset] backdrop-blur-xl"
              >
                <div className="border-b border-[var(--md-sys-color-outline-variant)]/80 px-3.5 py-2.5">
                  <p className="type-label-md text-[var(--md-sys-color-primary)]">문서 작업</p>
                  <p className="mt-0.5 truncate type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                    {selectedDocument.name}
                  </p>
                </div>
                <div className="p-1.5">
                  {paletteActions.map((action, index) => {
                    const selected = index === selectedActionIndex
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onMouseEnter={() => setSelectedActionIndex(index)}
                        onClick={() => runPaletteAction(action)}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                          selected
                            ? 'bg-[var(--md-sys-color-primary-container)]/42 text-[var(--md-sys-color-on-surface)]'
                            : 'text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-primary)]">
                          <Icon name={action.icon} size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block type-label-lg">{action.title}</span>
                          <span className="block truncate type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                            {action.description}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md border border-[var(--md-sys-color-outline-variant)] px-1.5 py-0.5 text-[0.68rem] font-semibold text-[var(--md-sys-color-on-surface-variant)]">
                          {action.shortcut}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <footer className="flex items-center justify-between gap-3 border-t border-[var(--md-sys-color-outline-variant)]/80 bg-[color-mix(in_srgb,var(--md-sys-color-surface-container-low)_76%,transparent)] px-4 py-2">
              <div className="flex items-center gap-1.5 type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                <span className="kbd-token">Esc</span>
                닫기
                <span className="kbd-token ml-2">Enter</span>
                상세
                <span className="kbd-token ml-2">Ctrl/Cmd K</span>
                작업
              </div>
              <div className="flex items-center gap-2">
                <Button variant="text" size="sm" leadingIcon="open_in_new" onClick={openInMainSearch}>
                  검색 탭에서 보기
                </Button>
                <Button variant="tonal" size="sm" leadingIcon="close" onClick={closePalette}>
                  닫기
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
