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


const FILE_TYPE_FILTERS = [
  { label: 'Word / DOCX', value: 'docx', icon: 'article' },
  { label: 'PPT / PPTX', value: 'pptx', icon: 'slideshow' },
  { label: 'Markdown / MD', value: 'md', icon: 'docs' },
  { label: 'Text / TXT', value: 'txt', icon: 'description' },
]

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

export default function FileSearch() {
  const snackbar = useSnackbar()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([])
  const [searchScope, setSearchScope] = useState<SearchScope>('filename_content')

  const [settings, setSettings] = useState<SchedulerSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SchedulerSettings | null>(null)
  const [reindexing, setReindexing] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.search.getSettings().then((response) => {
      setSettings(response.data)
      setSettingsDraft(response.data)
    })
  }, [])

  const doSearch = useCallback(
    async (q: string, fileTypes = selectedFileTypes, scope = searchScope) => {
      if (!q.trim()) {
        setResults([])
        setSearched(false)
        return
      }
      setLoading(true)
      try {
        const response = await api.search.query({
          query: q,
          limit: 200,
          file_types: fileTypes.length > 0 ? fileTypes : undefined,
          search_scope: scope,
        })
        setResults(response.data.results)
        setSearched(true)
      } catch {
        setResults([])
        snackbar.error('검색에 실패했습니다.')
      } finally {
        setLoading(false)
      }
    },
    [selectedFileTypes, searchScope, snackbar],
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value), 300)
  }

  const toggleFileType = (value: string) => {
    const next = selectedFileTypes.includes(value)
      ? selectedFileTypes.filter((item) => item !== value)
      : [...selectedFileTypes, value]
    setSelectedFileTypes(next)
    if (query.trim()) void doSearch(query, next, searchScope)
  }

  const handleSearchScopeChange = (next: SearchScope) => {
    setSearchScope(next)
    if (query.trim()) void doSearch(query, selectedFileTypes, next)
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

  const hasResults = !loading && results.length > 0
  const lastReindex = settings?.last_reindex_at
    ? new Date(settings.last_reindex_at).toLocaleString('ko-KR')
    : null

  return (
    <div className="space-y-6">
      <Card variant="elevated" className="p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="flex-1">
            <TextField
              leadingIcon="search"
              placeholder="파일 안의 단어를 검색 (예: 회의록, 예산안, 실험 결과)"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              trailing={
                query ? (
                  <IconButton
                    icon="close"
                    label="검색어 지우기"
                    size="sm"
                    onClick={() => {
                      setQuery('')
                      setResults([])
                      setSearched(false)
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
              onClick={() => doSearch(query, selectedFileTypes, searchScope)}
              disabled={!query.trim() || loading}
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
            <Icon name="bolt" size={16} /> {searchScope === 'filename' ? '파일명만 검색' : '파일명과 본문을 함께 검색'}
          </span>
          {lastReindex && (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="schedule" size={16} /> 마지막 검색 갱신 {lastReindex}
            </span>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">검색 범위</span>
            <div>
              <SegmentedButton<SearchScope>
                aria-label="검색 범위"
                value={searchScope}
                onChange={handleSearchScopeChange}
                options={[
                  { value: 'filename_content', label: '파일명 + 본문', icon: 'article' },
                  { value: 'filename', label: '파일명만', icon: 'drive_file_rename_outline' },
                ]}
              />
            </div>
            <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {searchScope === 'filename'
                ? '파일 이름에 검색어가 포함된 문서만 찾습니다.'
                : '파일 이름과 색인된 문서 본문을 함께 찾습니다.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="type-label-lg text-[var(--md-sys-color-on-surface-variant)]">문서 형식</span>
            {FILE_TYPE_FILTERS.map((filter) => (
              <Chip
                key={filter.value}
                label={filter.label}
                icon={filter.icon}
                kind="filter"
                selected={selectedFileTypes.includes(filter.value)}
                onClick={() => toggleFileType(filter.value)}
              />
            ))}
          </div>
          <p className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
            선택을 모두 해제하면 전체 형식에서 검색합니다.
          </p>
        </div>
      </Card>

      {settingsOpen && settingsDraft && (
        <Card variant="elevated" className="p-5 space-y-4 animate-slide-up">
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
          description={searchScope === 'filename' ? '파일명만 검색 중입니다. 파일명+본문으로 범위를 넓혀 보세요.' : '오탈자를 확인하거나 더 짧은 키워드로 다시 시도해 보세요.'}
        />
      )}

      {!loading && !searched && !query && (
        <EmptyState
          icon="manage_search"
          title={searchScope === 'filename' ? '파일명으로 빠르게 검색' : '파일명과 문서 내용을 한 번에 검색'}
          description={searchScope === 'filename' ? '파일명만 찾거나 검색 범위를 파일명+본문으로 바꿔 문서 안의 단어까지 검색할 수 있습니다.' : '먼저 설정에서 대상 폴더를 추가하면 Excel, Word, PPT, 텍스트 파일 안의 단어까지 검색할 수 있습니다.'}
        />
      )}

      {hasResults && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={`${results.length}건`} tone="primary" as="span" icon="filter_list" />
            {selectedFileTypes.length > 0 && (
              <Chip label={`형식 ${selectedFileTypes.length}개 선택`} tone="secondary" as="span" icon="checklist" />
            )}
            <span className="type-body-sm text-[var(--md-sys-color-on-surface-variant)]">
              {grouped.length}개 파일에서 매칭됨
            </span>
          </div>
          {grouped.map(([fileName, items]) => (
            <Card key={fileName} variant="outlined" className="overflow-hidden">
              <header className="px-5 py-3 flex items-center gap-2 flex-wrap border-b border-[var(--md-sys-color-outline-variant)]">
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
                {items.map((item, index) => (
                  <li
                    key={index}
                    className="px-5 py-3 border-t border-[var(--md-sys-color-outline-variant)] first:border-t-0 hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenFile(item.file_id, item.name)}
                      className="block w-full text-left"
                    >
                      <p className="type-label-md text-[var(--md-sys-color-primary)] mb-1 inline-flex items-center gap-1.5">
                        <Icon name="my_location" size={14} />
                        {item.location}
                      </p>
                      <SnippetText snippet={item.snippet} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
