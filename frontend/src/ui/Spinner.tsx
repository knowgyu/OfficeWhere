export function Spinner({
  size = 18,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      className={`inline-block align-middle ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} className="animate-spin">
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray="42 14"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
    </span>
  )
}
