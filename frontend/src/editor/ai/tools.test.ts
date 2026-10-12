import { createBlankDocument } from '@/lib/document'
import { EditorEngine } from '../engine/editor'
import { createMemoryAdapter } from '../dev/memoryAdapter'
import { executeDesignTool, inspectMotion, measureLayout, type Draft } from './tools'
import { runDesignAgent } from './agent'
import type { AIService } from '@/types/ai'

function setup() {
  const engine = new EditorEngine({
    adapter: createMemoryAdapter().adapter,
    document: createBlankDocument(800, 600),
    meta: { id: 'tools', title: 'Tools', mode: 'guest' },
    ephemeral: true,
  })
  const draft: Draft = { doc: engine.state.doc, pageId: engine.state.activePageId, selection: [], operations: [], images: [] }
  return { engine, draft }
}

it('measures exact gaps, center alignment, overlaps, clipping and page margins', () => {
  const report = measureLayout(
    [
      { id: 'a', left: 10, top: 10, width: 100, height: 50 },
      { id: 'b', left: 10, top: 80, width: 100, height: 50 },
      { id: 'c', left: 790, top: 20, width: 40, height: 50 },
    ],
    { width: 800, height: 600 },
  )
  const pair = report.pairs.find((entry) => entry.ids.includes('a') && entry.ids.includes('b'))!
  expect(pair.verticalGap).toBe(20)
  expect(pair.alignment.centerX.aligned).toBe(true)
  expect(pair.overlap).toBe(false)
  expect(report.layers.find((entry) => entry.id === 'c')?.clipped).toBe(true)
})

it('exposes every registered motion preset and applies animation only to draft', async () => {
  const { engine, draft } = setup()
  try {
    const signal = new AbortController().signal
    const catalog = await executeDesignTool(engine, draft, { id: 'catalog', name: 'get_motion_catalog', arguments: {} }, signal)
    expect((catalog.result as { enterExit: unknown[] }).enterExit.length).toBeGreaterThan(20)
    await executeDesignTool(
      engine,
      draft,
      {
        id: 'add',
        name: 'apply_design',
        arguments: {
          operations: [{ op: 'add', object: { type: 'rect', left: 10, top: 20, width: 100, height: 80, fill: '#ff8800' } }],
        },
      },
      signal,
    )
    const id = draft.doc.pages[0].objects[0].id
    await executeDesignTool(
      engine,
      draft,
      {
        id: 'motion',
        name: 'apply_design',
        arguments: {
          operations: [
            { op: 'animation', id, slot: 'enter', value: { preset: 'fade', durationMs: 600, delayMs: 0, easing: 'ease-out' } },
          ],
        },
      },
      signal,
    )
    expect(inspectMotion(draft.doc.pages[0]).spans).toHaveLength(1)
    expect(engine.state.doc.pages[0].objects).toHaveLength(0)
    await executeDesignTool(engine, draft, { id: 'view', name: 'capture_canvas', arguments: {} }, signal)
    await executeDesignTool(
      engine,
      draft,
      { id: 'frames', name: 'capture_motion', arguments: { mode: 'animation', times_ms: [0, 300, 600] } },
      signal,
    )
    expect(draft.images).toHaveLength(2)
    expect(draft.images[1].data.length).toBeGreaterThan(100)
    expect(engine.history.depth).toBe(0)
  } finally {
    engine.dispose()
  }
})

it('flags timeline overlap and unknown presets', () => {
  const report = inspectMotion({
    id: 'page',
    background: { type: 'solid', color: '#fff' },
    objects: [
      {
        id: 'a',
        type: 'rect',
        animation: {
          enter: { preset: 'missing', durationMs: 1000, delayMs: 0, easing: 'linear' },
          exit: { preset: 'fade', durationMs: 600, delayMs: 500, easing: 'linear' },
        },
      },
    ],
  })
  expect(report.issues).toEqual(expect.arrayContaining(['a: unknown enter preset missing', 'a: enter and exit overlap']))
})

it('runs draft tools then forces a real visual audit back through the provider before proposing', async () => {
  const { engine } = setup()
  const outputs = [
    {
      plan: null,
      tool_calls: [
        {
          id: 'add',
          name: 'apply_design',
          arguments: {
            operations: [{ op: 'add', object: { type: 'rect', left: 30, top: 30, width: 300, height: 200, fill: '#ff8800' } }],
          },
        },
      ],
      actual_tier: null,
      provider: 'test',
      model: 'test',
    },
    { plan: { message: 'Ready for review', operations: [] }, actual_tier: null, provider: 'test', model: 'test' },
    { plan: { message: 'Verified image and spacing', operations: [] }, actual_tier: 'priority', provider: 'test', model: 'test' },
  ]
  const generate = vi.fn().mockImplementation(async () => outputs.shift())
  const service = {
    tools: async () => ({ tools: [{ name: 'capture_canvas' }, { name: 'search_fonts' }] }),
    generate,
  } as unknown as AIService
  try {
    const proposal = await runDesignAgent(
      engine,
      service,
      { provider: 'test', api_key: 'key', model: 'test', prompt: 'Poster', speed: 'default', effort: 'default', messages: [] },
      new AbortController().signal,
      () => {},
    )
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[0][0].tool_results.map((result: { name: string }) => result.name)).toContain('search_fonts')
    expect(generate.mock.calls[2][0].images.length).toBeGreaterThan(0)
    expect(generate.mock.calls[2][0].tool_results.map((result: { name: string }) => result.name)).toEqual([
      'inspect_layout',
      'inspect_styles',
      'inspect_motion',
      'capture_canvas',
    ])
    expect(proposal.plan.message).toBe('Verified image and spacing')
    expect(proposal.preview.pages[0].objects).toHaveLength(1)
    expect(engine.state.doc.pages[0].objects).toHaveLength(0)
  } finally {
    engine.dispose()
  }
})
