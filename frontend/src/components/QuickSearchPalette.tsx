import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { api, getOfficeWhereBridge, type QuickSearchSettings, type SearchResult } from '../api/client'
import { Button, FileTypeBadge, Icon } from '../ui'

const SEARCH_DEBOUNCE_MS = 220
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

const DEFAULT_QUICK_SEARCH_SETTINGS: QuickSearchSettings = {
  supported: false,
  enabled: false,
  showRecent: false,
  accelerator: 'CommandOrControl+Alt+F',
  displayShortcut: 'Ctrl + Alt + F',
  registered: false,
  reason: '데스크톱 앱에서만 빠른 검색을 사용할 수 있습니다.',
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
  const requestSeq = useRef(0)
  const [query, setQuery] = useState('')
  const [documents, setDocuments] = useState<PaletteDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expandedFileId, setExpandedFileId] = useState<number | null>(null)
  const [settings, setSettings] = useState<QuickSearchSettings>(DEFAULT_QUICK_SEARCH_SETTINGS)

  const trimmedQuery = query.trim()
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

  const openInMainSearch = useCallback(() => {
    void api.app.openMainSearch(trimmedQuery)
  }, [trimmedQuery])

  useEffect(() => {
    document.documentElement.dataset.window = 'quick-search'
    return () => {
      delete document.documentElement.dataset.window
    }
  }, [])

  useEffect(() => {
    void api.app.getQuickSearchSettings().then((response) => setSettings(response.data))
    const unsubscribe = getOfficeWhereBridge()?.onQuickSearchOpened?.((payload) => {
      const displayShortcut = payload.displayShortcut
      if (displayShortcut) {
        setSettings((current) => ({ ...current, displayShortcut }))
      }
      window.setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    })
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => unsubscribe?.()
  }, [])

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
          search_scope: 'filename_content',
        })
        .then((response) => {
          if (requestSeq.current !== requestId) return
          const grouped = groupResults(response.data.results)
          setDocuments(grouped)
          setSelectedIndex(0)
          setExpandedFileId(grouped[0]?.fileId ?? null)
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
  }, [trimmedQuery])

  const statusText = useMemo(() => {
    if (loading) return '검색 중'
    if (error) return '검색 실패'
    if (!searched) return '입력 대기'
    return `${documents.length}개 문서`
  }, [documents.length, error, loading, searched])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
      return
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
      className="h-screen w-screen overflow-hidden bg-transparent px-3 py-3 text-[var(--md-sys-color-on-surface)]"
      onKeyDown={handleKeyDown}
    >
      <section
        className={`quick-search-shell flex flex-col overflow-hidden rounded-[1.45rem] border border-[color-mix(in_srgb,var(--md-sys-color-outline-variant)_80%,transparent)] bg-[color-mix(in_srgb,var(--md-sys-color-surface-container-lowest)_94%,transparent)] shadow-[0_30px_80px_rgba(0,0,0,0.28),0_1px_0_var(--ow-inset-highlight)_inset] backdrop-blur-2xl ${
          trimmedQuery ? 'h-full' : 'h-auto'
        }`}
      >
        <header
          className={`bg-[color-mix(in_srgb,var(--md-sys-color-surface-container-low)_78%,transparent)] px-4 py-3 ${
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
              className="h-12 min-w-0 flex-1 bg-transparent text-[1.35rem] font-semibold tracking-[-0.025em] text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)]"
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
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--md-sys-color-primary)]" />
                {statusText}
              </span>
              <span>↑↓ 이동 · Enter 상세 · Ctrl/⌘ Enter 위치 · Shift Enter 열기</span>
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
              <ul className="space-y-2">
                {documents.map((document, index) => {
                  const selected = index === selectedIndex
                  const expanded = expandedFileId === document.fileId
                  const firstSnippet = document.snippets[0]
                  return (
                    <li key={document.fileId}>
                    <button
                      type="button"
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => setExpandedFileId((current) => (current === document.fileId ? null : document.fileId))}
                      className={`state-host relative w-full rounded-2xl border p-3 text-left transition-all ${
                        selected
                          ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/36 shadow-elev-2'
                          : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                      }`}
                    >
                      <span className="state-layer" />
                      <span className="relative flex items-start gap-3">
                        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-primary)] shadow-[0_1px_0_var(--ow-inset-highlight)_inset]">
                          <Icon name={fileIcon(document.fileType)} size={22} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate type-title-sm text-[var(--md-sys-color-on-surface)]">
                              {document.name}
                            </span>
                            <FileTypeBadge fileType={document.fileType} />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 type-label-md text-[var(--md-sys-color-on-surface-variant)]">
                            <span className="truncate">{shortFolder(document.path)}</span>
                            <span>·</span>
                            <span>{document.snippets.length}개 일치</span>
                            {firstSnippet && (
                              <>
                                <span>·</span>
                                <span>{firstSnippet.location}</span>
                              </>
                            )}
                          </span>
                          {firstSnippet && (
                            <span className="mt-2 block line-clamp-2 type-body-sm text-[var(--md-sys-color-on-surface)]">
                              {highlightedParts(firstSnippet.snippet)}
                            </span>
                          )}
                        </span>
                        <Icon
                          name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
                          size={20}
                          className="mt-2 shrink-0 text-[var(--md-sys-color-on-surface-variant)]"
                        />
                      </span>
                    </button>

                    {expanded && (
                      <div className="mx-2 -mt-1 rounded-b-2xl border-x border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3 shadow-[0_1px_0_var(--ow-inset-highlight)_inset]">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="min-w-0 truncate font-mono text-[0.72rem] text-[var(--md-sys-color-on-surface-variant)]">
                            {document.path}
                          </p>
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
          <footer className="flex items-center justify-between gap-3 border-t border-[var(--md-sys-color-outline-variant)]/80 bg-[color-mix(in_srgb,var(--md-sys-color-surface-container-low)_76%,transparent)] px-4 py-2.5">
            <div className="flex items-center gap-1.5 type-label-md text-[var(--md-sys-color-on-surface-variant)]">
              <span className="kbd-token">Esc</span>
              닫기
              <span className="kbd-token ml-2">↵</span>
              상세
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
        )}
      </section>
    </div>
  )
}
