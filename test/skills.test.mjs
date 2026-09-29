import { readdir, readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const skillsRoot = new URL('../skills/', import.meta.url)

describe('skills library', () => {
  it('every skill has well-formed, uniquely named frontmatter', async () => {
    const dirs = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    assert.ok(dirs.length >= 15, `expected the full skill set, found ${dirs.length}`)

    const names = []
    for (const dir of dirs) {
      const raw = await readFile(new URL(`${dir}/SKILL.md`, skillsRoot), 'utf8')
      assert.ok(raw.startsWith('---\n'), `${dir}/SKILL.md must open with frontmatter`)
      const frontmatter = raw.slice(4, raw.indexOf('\n---', 4))
      const name = frontmatter.match(/^name:\s*(\S+)/m)?.[1]
      assert.equal(name, dir, `${dir}/SKILL.md frontmatter name must match its directory`)
      assert.ok(
        /^description:\s*\S/m.test(frontmatter),
        `${dir}/SKILL.md must describe when to use it`
      )
      names.push(name)
    }
    assert.equal(new Set(names).size, names.length, 'skill names must be unique')
  })
})
