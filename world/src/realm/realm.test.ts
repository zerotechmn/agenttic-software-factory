import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROLES } from '../domain/types'
import { TASKS } from '../sim/scenario'
import { AGENTS, DISTRICTS } from './realm'

const file = (p: string) => existsSync(new URL(`../../public/forge/${p}.webp`, import.meta.url))

describe('realm', () => {
  it('has a profile for every role', () => {
    expect(Object.keys(AGENTS).sort()).toEqual([...ROLES].sort())
  })

  it('every character has its built art (run scripts/build-assets.mjs if this fails)', () => {
    for (const a of Object.values(AGENTS)) {
      if (!a.art) continue
      for (const kind of ['char', 'card', 'home']) expect(file(`${kind}/${a.art}`), `${kind}/${a.art}`).toBe(true)
    }
    for (const d of Object.values(DISTRICTS)) if (d.background) expect(file(`bg/${d.background}`), d.background).toBe(true)
    expect(file('map')).toBe(true)
  })

  it('anchors stay on the map and every agent lives in a known district', () => {
    for (const a of Object.values(AGENTS)) {
      expect(DISTRICTS[a.district]).toBeDefined()
      for (const v of [...a.anchor, ...DISTRICTS[a.district].anchor]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })

  it('every task owner is a character who can work it', () => {
    for (const t of TASKS) expect(AGENTS[t.ownerRole].art, t.id).toBeDefined()
  })
})
