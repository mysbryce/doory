import type { FontFamily } from '@/types/api'
import { createBlankDocument } from '@/lib/document'
import { createMemoryAdapter } from '../dev/memoryAdapter'
import { EditorEngine } from '../engine/editor'
import { searchFonts } from './fonts'
import { executeDesignTool, type Draft } from './tools'

const signal = () => new AbortController().signal
const font = (family: string, scripts = ['latin', 'thai']): FontFamily => ({
  id: 'private-owner-library-id',
  family,
  category: 'sans-serif',
  scripts,
  is_variable: false,
  is_user_font: true,
  popularity: 9999,
  variants: [400, 700].map((weight) => ({ weight, style: 'normal', url: '/private/brand-font.ttf' })),
})

function setup() {
  const { adapter } = createMemoryAdapter()
  const list = vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] })
  adapter.services.fonts.list = list
  const engine = new EditorEngine({
    adapter,
    document: createBlankDocument(800, 600),
    meta: { id: 'font-tools', title: 'Fonts', mode: 'guest' },
    ephemeral: true,
  })
  return { engine, list }
}

it('discovers uploaded Thai fonts with real weights and omits private IDs and file URLs', async () => {
  const { engine, list } = setup()
  try {
    engine.userFonts.attach({ list, mine: { list: async () => [font('Brand Thai')], upload: vi.fn(), remove: vi.fn() } })
    const result = await searchFonts(engine, { script: 'thai' }, signal())
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ script: 'thai' }))
    expect(result.local.fonts).toEqual([
      expect.objectContaining({
        family: 'Brand Thai',
        source: 'uploaded',
        weights: [400, 700],
        styles: ['normal'],
        scripts: ['latin', 'thai'],
      }),
    ])
    expect(JSON.stringify(result)).not.toMatch(/private-owner|\/private\/|\.ttf/)
  } finally {
    engine.dispose()
  }
})

it('does not advertise declared Thai coverage when only Latin subset files were installed', async () => {
  const { engine, list } = setup()
  try {
    const declared = {
      ...font('Catalog Thai'),
      is_user_font: false,
      variants: [{ weight: 400, style: 'normal', url: '/latin.woff2', subsets: [{ subset: 'latin', url: '/latin.woff2' }] }],
    }
    list.mockResolvedValue({ count: 1, next: '/next-catalog-page', results: [declared] })
    const result = await searchFonts(engine, { source: 'catalog', script: 'thai' }, signal())
    expect(result.catalog.fonts).toEqual([])
    expect(result.catalog.next_page).toBe(2)
    expect(result.warnings.join(' ')).toContain('installed subsets')
    const unfiltered = await searchFonts(engine, { source: 'catalog' }, signal())
    expect(unfiltered.catalog.fonts[0]).toMatchObject({ scripts: ['latin'], declared_scripts: ['latin', 'thai'] })
  } finally {
    engine.dispose()
  }
})

it('reports actual bundled styles and marks device font coverage unknown', async () => {
  const { engine } = setup()
  try {
    const bundled = await searchFonts(engine, { source: 'bundled' }, signal())
    expect(bundled.local.fonts.find(({ family }) => family === 'Inter')).toMatchObject({
      styles: ['normal'],
      weight_range: { min: 100, max: 900 },
    })
    expect(bundled.local.fonts.find(({ family }) => family === 'Nunito')).toMatchObject({ styles: ['normal', 'italic'] })
    const thai = await searchFonts(engine, { source: 'bundled', script: 'thai' }, signal())
    expect(thai.local.fonts).toEqual([])
    const system = await searchFonts(engine, { source: 'system', query: 'Tahoma' }, signal())
    expect(system.local.fonts[0]).toMatchObject({ family: 'Tahoma', coverage: 'device-dependent', scripts: null, weights: null })
  } finally {
    engine.dispose()
  }
})

it('paginates local custom fonts and stays within the shared design library', async () => {
  const { engine, list } = setup()
  try {
    engine.userFonts.attach({ list, provided: [font('Owner A'), font('Owner B'), font('Owner C')] })
    const result = await searchFonts(engine, { source: 'custom', page: 2, page_size: 1 }, signal())
    expect(result.local).toMatchObject({ count: 3, next_page: 3, fonts: [{ family: 'Owner B', source: 'shared' }] })
    expect(list).not.toHaveBeenCalled()
  } finally {
    engine.dispose()
  }
})

it('preserves a custom face that shares a bundled name through search and draft application', async () => {
  const { engine, list } = setup()
  try {
    const custom = font('Inter')
    engine.userFonts.attach({ list, provided: [custom] })
    list.mockResolvedValue({ count: 1, next: null, results: [{ ...custom, is_user_font: false, id: 'public-id' }] })
    const result = await searchFonts(engine, { query: 'Inter' }, signal())
    expect(result.local.fonts).toHaveLength(1)
    expect(result.catalog.fonts).toHaveLength(0)
    expect((await engine.fonts.lookup('Inter'))?.is_user_font).toBe(true)
    const draft: Draft = { doc: engine.state.doc, pageId: engine.state.activePageId, selection: [], operations: [], images: [] }
    await executeDesignTool(
      engine,
      draft,
      {
        id: 'font-edit',
        name: 'apply_design',
        arguments: {
          operations: [
            {
              op: 'add',
              object: {
                type: 'textbox',
                text: 'Hello',
                left: 20,
                top: 20,
                width: 200,
                height: 60,
                fill: '#111',
                fontFamily: 'Inter',
              },
            },
          ],
        },
      },
      signal(),
    )
    expect(draft.doc.pages[0].objects[0].fontFamily).toBe('"Inter", sans-serif')
    expect(engine.state.doc.pages[0].objects).toHaveLength(0)
  } finally {
    engine.dispose()
  }
})

it('returns explicit incomplete-catalog evidence on errors and stops after cancellation', async () => {
  const { engine, list } = setup()
  try {
    list.mockRejectedValue(new Error('private backend details'))
    const result = await searchFonts(engine, {}, signal())
    expect(result.local.fonts.length).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toContain('Catalog results are incomplete')
    expect(JSON.stringify(result)).not.toContain('private backend details')
    const controller = new AbortController()
    controller.abort()
    await expect(searchFonts(engine, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(searchFonts(engine, { page_size: 1000 }, signal())).rejects.toThrow('Invalid font search')
  } finally {
    engine.dispose()
  }
})
