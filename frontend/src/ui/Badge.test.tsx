import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileTypeBadge } from './Badge'

describe('FileTypeBadge', () => {
  it.each([
    ['Word', 'DOCX'],
    ['docx', 'DOCX'],
    ['Excel', 'XLSX'],
    ['xlsx', 'XLSX'],
    ['PowerPoint', 'PPTX'],
    ['pptx', 'PPTX'],
    ['PDF', 'PDF'],
  ])('renders %s as a compact extension label', (fileType, label) => {
    render(<FileTypeBadge fileType={fileType} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('uses a fixed-width centered chip layout', () => {
    const { container } = render(<FileTypeBadge fileType="PowerPoint" />)

    expect(container.firstElementChild).toHaveClass('w-12', 'justify-center', 'text-center')
  })

  it('does not render long product labels inside the chip', () => {
    render(<FileTypeBadge fileType="PowerPoint" />)

    expect(screen.queryByText('PowerPoint')).not.toBeInTheDocument()
  })
})
