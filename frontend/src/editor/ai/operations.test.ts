import { createBlankDocument } from '@/lib/document'
import type { AIPlan } from '@/types/ai'
import { EditorEngine } from '../engine/editor'
import { createMemoryAdapter } from '../dev/memoryAdapter'
import { applyPlan, pageContext, pageSignature } from './operations'

const plan: AIPlan = {
  message: 'Poster',
  operations: [
    { op: 'background', color: '#ffeecc' },
    { op: 'add', object: { type: 'ellipse', left: 30, top: 20, width: 80, height: 120, fill: '#ff8800' } },
    { op: 'add', object: { type: 'textbox', left: 30, top: 180, width: 300, height: 100, text: 'Summer', fill: '#221100' } },
  ],
}

describe('AI graphic proposals', () => {
  it('applies one immutable page edit, preserving other pages and generating fresh ids', () => {
    const doc = createBlankDocument(800, 600)
    const page = doc.pages[0]
    const extra = { ...page, id: 'other', objects: [] }
    doc.pages.push(extra)
    const next = applyPlan(doc, page.id, plan)
    expect(doc.pages[0].objects).toHaveLength(0)
    expect(next.pages[1]).toBe(extra)
    expect(next.pages[0].background).toEqual({ type: 'solid', color: '#ffeecc' })
    expect(next.pages[0].objects[0]).toMatchObject({ type: 'ellipse', rx: 40, ry: 60, originX: 'left', originY: 'top' })
    expect(next.pages[0].objects[1]).toMatchObject({
      type: 'textbox',
      fontFamily: '"Inter Variable", "Inter", sans-serif',
      fontSize: 32,
      fontWeight: 400,
    })
    expect(next.pages[0].objects[0].id).not.toBe(applyPlan(doc, page.id, plan).pages[0].objects[0].id)
  })

  it('preserves existing object metadata and rejects locked or missing targets atomically', () => {
    const doc = createBlankDocument(800, 600)
    const page = doc.pages[0]
    page.objects.push({
      id: 'text',
      type: 'itext',
      text: 'Old',
      left: 40,
      top: 60,
      originX: 'center',
      animation: { custom: true },
    })
    const updated = applyPlan(doc, page.id, { message: '', operations: [{ op: 'update', id: 'text', props: { text: 'New' } }] })
    expect(updated.pages[0].objects[0]).toMatchObject({ text: 'New', originX: 'center', animation: { custom: true } })
    page.objects[0].locked = true
    expect(() =>
      applyPlan(doc, page.id, {
        message: '',
        operations: [
          { op: 'background', color: '#fff' },
          { op: 'delete', id: 'text' },
        ],
      }),
    ).toThrow(/locked/)
    expect(page.background).toEqual({ type: 'solid', color: '#ffffff' })
    expect(() => applyPlan(doc, page.id, { message: '', operations: [{ op: 'delete', id: 'missing' }] })).toThrow()
  })

  it('never sends asset URLs, hyperlinks, private metadata or other pages to providers', () => {
    const doc = createBlankDocument(800, 600)
    const page = doc.pages[0]
    page.objects.push({
      id: 'photo',
      type: 'image',
      src: 'https://secret/image',
      assetId: 'secret-asset',
      link: { url: 'https://private/' },
      metadata: { token: 'secret' },
      name: 'Photo',
      left: 40,
      originX: 'center',
      scaleX: 0.5,
    })
    page.background = { type: 'image', src: 'https://secret/background', fit: 'cover' }
    const context = pageContext(doc, page, ['photo'])
    expect(context.objects[0]).toEqual({
      id: 'photo',
      type: 'image',
      locked: false,
      name: 'Photo',
      left: 40,
      originX: 'center',
      scaleX: 0.5,
    })
    expect(JSON.stringify(context)).not.toMatch(/secret|private|https/)
    expect(context.background).toBe('image')
  })

  it('detects concurrent resize, object edits and page deletion', () => {
    const doc = createBlankDocument(800, 600)
    const page = doc.pages[0]
    const signature = pageSignature(doc, page)
    expect(pageSignature({ ...doc, width: 900 }, page)).not.toBe(signature)
    expect(pageSignature(doc, { ...page, objects: [{ id: 'new', type: 'rect' }] })).not.toBe(signature)
    expect(() => applyPlan({ ...doc, pages: [] }, page.id, plan)).toThrow(/no longer exists/)
  })

  it('rejects executable content and external image sources from arbitrary adapters', () => {
    const doc = createBlankDocument(800, 600)
    const bad = {
      message: 'bad',
      operations: [{ op: 'add', object: { type: 'rect', src: 'https://evil.example', left: 0, top: 0 } }],
    } as unknown as AIPlan
    expect(() => applyPlan(doc, doc.pages[0].id, bad)).toThrow(/unsupported/)
  })

  it('records one engine history step, allowing complete undo and redo', async () => {
    const engine = new EditorEngine({
      adapter: createMemoryAdapter().adapter,
      document: createBlankDocument(800, 600),
      meta: { id: 'design', title: 'Poster', mode: 'guest' },
      ephemeral: true,
    })
    try {
      const doc = engine.state.doc
      engine.applyDocument(applyPlan(doc, doc.pages[0].id, plan), { label: 'AI design' })
      expect(engine.history.depth).toBe(1)
      expect(engine.state.doc.pages[0].objects).toHaveLength(2)
      await engine.undo()
      expect(engine.state.doc).toEqual(doc)
      await engine.redo()
      expect(engine.state.doc.pages[0].objects).toHaveLength(2)
    } finally {
      engine.dispose()
    }
  })
})
