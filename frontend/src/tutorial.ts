export type TutorialStep =
  | 'example-folder'
  | 'document-refresh'
  | 'search'
  | 'search-results'
  | 'search-review'
  | 'version-ppt'
  | 'version-ppt-review'
  | 'version-ppt-detail'
  | 'version-excel-search'
  | 'version-excel'
  | 'version-excel-review'
  | 'excel-table'
  | 'excel-table-cell'
  | 'excel-table-history'
  | 'done'

export const EXAMPLE_SEARCH_QUERY = '프로젝트'
export const EXAMPLE_PPT_QUERY = '프로젝트상태'
export const EXAMPLE_EXCEL_QUERY = '사업예산'

export const TUTORIAL_ACTIVE_STEPS: TutorialStep[] = [
  'example-folder',
  'document-refresh',
  'search',
  'search-results',
  'search-review',
  'version-ppt',
  'version-ppt-review',
  'version-ppt-detail',
  'version-excel-search',
  'version-excel',
  'version-excel-review',
  'excel-table',
  'excel-table-cell',
  'excel-table-history',
]

export type TutorialSectionId = 'folder' | 'search' | 'version'

export interface TutorialSection {
  id: TutorialSectionId
  label: string
  range: [number, number] // 1-based inclusive
}

export const TUTORIAL_SECTIONS: TutorialSection[] = [
  { id: 'folder', label: '폴더 설정', range: [1, 2] },
  { id: 'search', label: '문서 검색', range: [3, 5] },
  { id: 'version', label: '버전 비교', range: [6, 14] },
]

export function getTutorialStepIndex(step: TutorialStep): number {
  if (step === 'done') return 0
  const idx = TUTORIAL_ACTIVE_STEPS.indexOf(step)
  return idx === -1 ? 0 : idx + 1
}

export function getTutorialSection(step: TutorialStep): TutorialSection | null {
  const idx = getTutorialStepIndex(step)
  if (!idx) return null
  return TUTORIAL_SECTIONS.find((s) => idx >= s.range[0] && idx <= s.range[1]) ?? null
}

export const TUTORIAL_TOTAL_STEPS = 14
