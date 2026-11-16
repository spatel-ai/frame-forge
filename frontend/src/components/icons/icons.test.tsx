import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { icons } from '.'

function renderSvg(node: React.ReactElement): SVGSVGElement {
  const svg = render(node).container.querySelector('svg')
  if (!svg) throw new Error('no svg rendered')
  return svg
}

describe('icons', () => {
  for (const [name, Icon] of Object.entries(icons)) {
    it(`${name} renders an aria-hidden svg at the default size`, () => {
      const svg = renderSvg(<Icon />)
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      expect(svg.getAttribute('fill')).toBe('none')
      expect(svg.getAttribute('width')).toBe('20')
    })

    it(`${name} respects the size prop`, () => {
      const svg = renderSvg(<Icon size={32} />)
      expect(svg.getAttribute('width')).toBe('32')
      expect(svg.getAttribute('height')).toBe('32')
    })
  }
})
