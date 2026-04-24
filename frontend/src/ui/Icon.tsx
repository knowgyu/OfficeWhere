import { CSSProperties } from 'react'

export interface IconProps {
  name: string
  filled?: boolean
  weight?: 300 | 400 | 500 | 600 | 700
  size?: number
  grade?: -25 | 0 | 200
  className?: string
  'aria-hidden'?: boolean
  title?: string
}

/**
 * Material Symbols Rounded icon wrapper.
 * Uses Google Fonts variable font `fill`, `wght`, `GRAD`, `opsz` axes.
 */
export function Icon({
  name,
  filled = false,
  weight = 400,
  size = 20,
  grade = 0,
  className = '',
  'aria-hidden': ariaHidden = true,
  title,
}: IconProps) {
  const style: CSSProperties = {
    fontSize: `${size}px`,
    fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${size}`,
  }
  return (
    <span
      className={`material-symbol ${className}`}
      style={style}
      aria-hidden={ariaHidden}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {name}
    </span>
  )
}
