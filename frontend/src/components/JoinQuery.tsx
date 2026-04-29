import { Badge, Card, EmptyState } from '../ui'

export default function JoinQuery() {
  return (
    <div className="space-y-5 animate-fade-in">
      <Card className="overflow-hidden">
        <div className="p-8 md:p-10">
          <div className="mb-5 flex items-center gap-2">
            <Badge tone="tertiary">준비 중</Badge>
            <Badge tone="neutral">검색 · 버전 관리 우선</Badge>
          </div>
          <EmptyState
            icon="table_chart"
            title="Excel 통합은 잠시 정리 중입니다"
            description="OfficeWhere는 우선 문서 검색과 버전 변경 확인을 안정적으로 다듬고 있습니다. 여러 Excel 표를 합치는 기능은 이후 더 단순한 흐름으로 다시 제공할 예정입니다."
          />
        </div>
      </Card>
    </div>
  )
}
