import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = __dirname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** Relative module specifiers that a file imports, re-exports or mocks. */
function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const found = text.matchAll(/(?:from|import|vi\.mock|vi\.importActual)\s*\(?\s*['"](\.[^'"]*)['"]/g)
  return [...found].map((m) => m[1])
}

/** The feature a resolved path belongs to (`features/<name>/...`), or null. `../` hops are resolved first. */
function featureOf(path: string): string | null {
  const parts = relative(SRC, path).split(sep)
  return parts[0] === 'features' && parts.length > 2 ? parts[1] : null
}

describe('layering (R-42)', () => {
  it('R-42 features do not import from other features', () => {
    const bad: string[] = []
    for (const file of sourceFiles(join(SRC, 'features'))) {
      const own = featureOf(file)
      for (const spec of specifiers(file)) {
        const target = featureOf(resolve(dirname(file), spec))
        if (target && target !== own) bad.push(`${relative(SRC, file)} imports ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('R-42 components/ and lib/ do not import from features/', () => {
    const bad: string[] = []
    for (const dir of ['components', 'lib']) {
      for (const file of sourceFiles(join(SRC, dir))) {
        for (const spec of specifiers(file)) {
          if (featureOf(resolve(dirname(file), spec)) !== null) bad.push(`${relative(SRC, file)} imports ${spec}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('R-42 the scan sees files in every layer', () => {
    expect(sourceFiles(join(SRC, 'features')).length).toBeGreaterThan(10)
    expect(sourceFiles(join(SRC, 'components')).length).toBeGreaterThan(10)
    expect(sourceFiles(join(SRC, 'lib')).length).toBeGreaterThan(2)
  })
})
