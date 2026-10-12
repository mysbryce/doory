import type { AIImage, AIPlan, AIToolCall, AIToolResult } from '@/types/ai'
import type { DocPage, DoryDocument } from '@/types/document'
import type { EditorEngine } from '../engine/editor'
import { deserializeObjects } from '../engine/serialization'
import { pageSize } from '../engine/docOps'
import { renderPageToCanvas } from '../engine/render'
import { parseColor } from '../engine/colors'
import { createFrameRenderer } from '../animation/frameRenderer'
import { animationOf, pageSpans, pageTiming } from '../animation/model'
import { emphasisPresets, inOutPresets, transitionPresets } from '../animation/presets'
import { sampleTransition } from '../animation/sampler'
import { drawTransition } from '../animation/transitionRenderer'
import { applyPlan, pageContext } from './operations'
import { searchFonts } from './fonts'

export interface Draft {
  doc: DoryDocument
  pageId: string
  selection: string[]
  operations: AIPlan['operations']
  images: AIImage[]
}
type Box = { id: string; left: number; top: number; width: number; height: number }
const round = (value: number) => Math.round(value * 100) / 100
const pageOf = (draft: Draft): DocPage => {
  const page = draft.doc.pages.find((p) => p.id === draft.pageId)
  if (!page) throw new Error('Source page missing.')
  return page
}

async function boxesOf(editor: EditorEngine, page: DocPage): Promise<Box[]> {
  const built = await deserializeObjects(page.objects, editor.loadContext)
  try {
    return built.map((object, index) => ({ id: page.objects[index].id, ...object.getBoundingRect() }))
  } finally {
    built.forEach((object) => object.dispose())
  }
}

function choose(page: DocPage, ids: unknown): DocPage {
  if (ids === undefined) return page
  if (!Array.isArray(ids) || ids.length > 60 || ids.some((id) => typeof id !== 'string')) throw new Error('Invalid layer ids.')
  const selected = new Set(ids)
  return { ...page, objects: page.objects.filter((object) => selected.has(object.id)) }
}

export function measureLayout(boxes: readonly Box[], size: { width: number; height: number }, tolerance = 2) {
  const layers = boxes.slice(0, 60).map((box) => ({
    ...box,
    margins: {
      left: round(box.left),
      top: round(box.top),
      right: round(size.width - box.left - box.width),
      bottom: round(size.height - box.top - box.height),
    },
    clipped:
      box.left < -tolerance ||
      box.top < -tolerance ||
      box.left + box.width > size.width + tolerance ||
      box.top + box.height > size.height + tolerance,
  }))
  const pairs = []
  for (let i = 0; i < Math.min(60, boxes.length); i++)
    for (let j = i + 1; j < Math.min(60, boxes.length); j++) {
      const a = boxes[i],
        b = boxes[j]
      const gapX = Math.max(a.left, b.left) - Math.min(a.left + a.width, b.left + b.width)
      const gapY = Math.max(a.top, b.top) - Math.min(a.top + a.height, b.top + b.height)
      const deltas = {
        left: a.left - b.left,
        right: a.left + a.width - b.left - b.width,
        centerX: a.left + a.width / 2 - b.left - b.width / 2,
        top: a.top - b.top,
        bottom: a.top + a.height - b.top - b.height,
        centerY: a.top + a.height / 2 - b.top - b.height / 2,
      }
      pairs.push({
        ids: [a.id, b.id],
        horizontalGap: round(gapX),
        verticalGap: round(gapY),
        overlap: gapX < 0 && gapY < 0,
        alignment: Object.fromEntries(
          Object.entries(deltas).map(([key, delta]) => [key, { delta: round(delta), aligned: Math.abs(delta) <= tolerance }]),
        ),
      })
    }
  pairs.sort((a, b) => Math.max(0, a.horizontalGap, a.verticalGap) - Math.max(0, b.horizontalGap, b.verticalGap))
  return {
    units: 'CSS px',
    tolerance,
    layers,
    pairs: pairs.slice(0, 80),
    pairLimit: 80,
    truncated: boxes.length > 60,
    note: 'Negative gaps mean overlapping extents. Overlaps may be intentional. Rotated objects use axis-aligned visual bounds.',
  }
}

const luminance = (r: number, g: number, b: number) =>
  [r, g, b]
    .map((value) => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)

function imageOf(canvas: HTMLCanvasElement, label: string): AIImage {
  const data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
  if (!data || data.length > 400000) throw new Error('Rendered preview exceeds the image budget.')
  return { label, media_type: 'image/jpeg', data }
}

export async function inspectStyles(editor: EditorEngine, draft: Draft, ids?: unknown) {
  const page = pageOf(draft)
  const selected = choose(page, ids)
  const boxes = await boxesOf(editor, selected)
  const size = pageSize(draft.doc, page)
  const scale = Math.min(1, 640 / Math.max(size.width, size.height))
  const underText = { ...page, objects: page.objects.filter((object) => !['textbox', 'itext', 'text'].includes(object.type)) }
  const background = await renderPageToCanvas(underText, size, editor.loadContext, { multiplier: scale })
  try {
    const pixels = background.getContext('2d', { willReadFrequently: true })
    const palette = new Set<string>(),
      fonts = new Set<string>(),
      sizes = new Set<number>()
    const layers = selected.objects.slice(0, 60).map((object, index) => {
      if (typeof object.fill === 'string') palette.add(object.fill)
      if (typeof object.fontFamily === 'string') fonts.add(object.fontFamily)
      if (typeof object.fontSize === 'number') sizes.add(object.fontSize)
      const box = boxes[index]
      const color = typeof object.fill === 'string' ? parseColor(object.fill) : null
      let contrast = null
      if (pixels && color && typeof object.text === 'string') {
        const x = Math.max(0, Math.min(background.width - 1, Math.round((box.left + box.width / 2) * scale)))
        const y = Math.max(0, Math.min(background.height - 1, Math.round((box.top + box.height / 2) * scale)))
        const sample = pixels.getImageData(x, y, 1, 1).data
        const bgL = luminance(sample[0], sample[1], sample[2]),
          fgL = luminance(color.r, color.g, color.b)
        const ratio = (Math.max(bgL, fgL) + 0.05) / (Math.min(bgL, fgL) + 0.05)
        const threshold =
          Number(object.fontSize) >= 24 || (Number(object.fontSize) >= 18.66 && Number(object.fontWeight) >= 700) ? 3 : 4.5
        contrast = {
          ratio: round(ratio),
          threshold,
          belowThreshold: ratio < threshold,
          approximate: true,
          note: 'Raster sample under text at box center. Transparent fills, image/gradient variation and occlusion need visual review.',
        }
      }
      const style: Record<string, unknown> = { id: object.id, type: object.type }
      for (const key of [
        'text',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'lineHeight',
        'charSpacing',
        'textAlign',
        'fill',
        'stroke',
        'strokeWidth',
        'opacity',
        'effects',
        'underline',
        'linethrough',
        'overline',
      ])
        if (object[key] !== undefined) style[key] = object[key]
      return { ...style, contrast }
    })
    return {
      layers,
      palette: [...palette],
      fonts: [...fonts],
      fontSizes: [...sizes].sort((a, b) => a - b),
      truncated: selected.objects.length > 60,
    }
  } finally {
    background.width = 1
    background.height = 1
  }
}

export function inspectMotion(page: DocPage) {
  const spans = pageSpans(page),
    issues: string[] = []
  for (const object of page.objects) {
    const animation = animationOf(object)
    if (!animation) continue
    for (const [slot, anim] of Object.entries(animation)) {
      const registry = slot === 'emphasis' ? emphasisPresets : inOutPresets
      if (!registry.has(anim.preset)) issues.push(`${object.id}: unknown ${slot} preset ${anim.preset}`)
      if (anim.delayMs + anim.durationMs > (page.durationSec ?? 5) * 1000)
        issues.push(`${object.id}: ${slot} extends beyond page duration`)
    }
    if (animation.enter && animation.exit && animation.exit.delayMs < animation.enter.delayMs + animation.enter.durationMs)
      issues.push(`${object.id}: enter and exit overlap`)
  }
  if (page.transition && !transitionPresets.has(page.transition.preset))
    issues.push(`Unknown transition: ${page.transition.preset}`)
  if (page.transition && page.transition.durationMs > (page.durationSec ?? 5) * 1000)
    issues.push('Transition exceeds page duration')
  return {
    durationSec: page.durationSec ?? 5,
    transition: page.transition ?? null,
    timing: pageTiming(page),
    spans: spans.slice(0, 120),
    issues: issues.slice(0, 120),
    truncated: spans.length > 120 || issues.length > 120,
  }
}

async function captureMotion(editor: EditorEngine, draft: Draft, args: Record<string, unknown>): Promise<AIImage> {
  const page = pageOf(draft),
    size = pageSize(draft.doc, page)
  const multiplier = Math.min(1, 320 / Math.max(size.width, size.height))
  const renderer = await createFrameRenderer(page, size, editor.loadContext, { multiplier })
  const mode = args.mode ?? 'animation'
  const times = (args.times_ms as number[] | undefined) ?? [0, 250, 600, 1200]
  if (times.length < 2 || times.length > 6 || times.some((time) => !Number.isFinite(time) || time < 0 || time > 120000))
    throw new Error('Invalid motion sample times.')
  const sheet = document.createElement('canvas')
  const cols = Math.min(3, times.length),
    rows = Math.ceil(times.length / cols),
    labelHeight = 24
  sheet.width = renderer.width * cols
  sheet.height = (renderer.height + labelHeight) * rows
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  let previous: Awaited<ReturnType<typeof createFrameRenderer>> | null = null
  try {
    const previousPage = draft.doc.pages[draft.doc.pages.findIndex((entry) => entry.id === page.id) - 1]
    if (mode === 'transition' && previousPage)
      previous = await createFrameRenderer(previousPage, size, editor.loadContext, { multiplier })
    for (const [index, time] of times.entries()) {
      const x = (index % cols) * renderer.width,
        y = Math.floor(index / cols) * (renderer.height + labelHeight)
      let frame = renderer.render(time)
      let label = `${time} ms`
      if (mode === 'transition') {
        if (!page.transition || !previous) throw new Error('Transition capture needs a transition and a previous page.')
        const progress = index / (times.length - 1)
        const out = document.createElement('canvas')
        out.width = renderer.width
        out.height = renderer.height
        drawTransition(
          out.getContext('2d')!,
          sampleTransition(page.transition, progress),
          previous.render(120000),
          renderer.render(120000),
          out.width,
          out.height,
        )
        frame = out
        label = `${Math.round(progress * 100)}% · ${Math.round(progress * page.transition.durationMs)} ms`
      }
      ctx.drawImage(frame, x, y)
      ctx.fillStyle = '#222222'
      ctx.font = '12px sans-serif'
      ctx.fillText(label, x + 6, y + renderer.height + 16)
    }
    return imageOf(sheet, `${mode} filmstrip`)
  } finally {
    renderer.dispose()
    previous?.dispose()
    sheet.width = 1
    sheet.height = 1
  }
}

/** All writes land in Draft. This executor never calls applyDocument, persistence, file APIs or shell. */
export async function executeDesignTool(
  editor: EditorEngine,
  draft: Draft,
  call: AIToolCall,
  signal: AbortSignal,
): Promise<AIToolResult> {
  signal.throwIfAborted()
  const page = pageOf(draft),
    size = pageSize(draft.doc, page),
    args = call.arguments
  let result: unknown
  switch (call.name) {
    case 'get_canvas': {
      const context = pageContext(draft.doc, page, draft.selection)
      result = { ...context, objects: context.objects.slice(0, 60), totalLayers: page.objects.length }
      break
    }
    case 'inspect_layout': {
      const selected = choose(page, args.ids)
      const boxes = await boxesOf(editor, selected)
      const textOverflow = selected.objects.flatMap((object, index) => {
        if (object.type !== 'textbox' || typeof object.height !== 'number') return []
        const expected = object.height * Number(object.scaleY ?? 1)
        return boxes[index].height > expected + 2
          ? [{ id: object.id, requestedHeight: expected, renderedHeight: round(boxes[index].height) }]
          : []
      })
      result = { ...measureLayout(boxes, size, Number(args.tolerance ?? 2)), textOverflow }
      break
    }
    case 'inspect_styles':
      result = await inspectStyles(editor, draft, args.ids)
      break
    case 'search_fonts':
      result = await searchFonts(editor, args, signal)
      break
    case 'get_motion_catalog':
      result = {
        enterExit: inOutPresets.list().map(({ id, label, defaults, directions, textUnits, textDefault }) => ({
          id,
          label,
          defaults,
          directions,
          textUnits,
          textDefault,
        })),
        emphasis: emphasisPresets.list().map(({ id, label, defaults }) => ({ id, label, defaults })),
        transitions: transitionPresets.list().map(({ id, label, defaults, directions }) => ({ id, label, defaults, directions })),
        easing: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'bounce'],
        textUnits: ['object', 'line', 'word', 'letter'],
      }
      break
    case 'inspect_motion':
      result = inspectMotion(page)
      break
    case 'capture_canvas': {
      const scale = Math.min(1, 768 / Math.max(size.width, size.height))
      if (args.time_ms !== undefined) {
        const renderer = await createFrameRenderer(page, size, editor.loadContext, { multiplier: scale })
        try {
          draft.images.push(imageOf(renderer.render(Number(args.time_ms)), `Canvas at ${args.time_ms} ms`))
        } finally {
          renderer.dispose()
        }
      } else {
        const canvas = await renderPageToCanvas(page, size, editor.loadContext, { multiplier: scale })
        try {
          draft.images.push(imageOf(canvas, 'Current draft canvas'))
        } finally {
          canvas.width = 1
          canvas.height = 1
        }
      }
      result = { image: draft.images.at(-1)?.label, width: size.width, height: size.height }
      break
    }
    case 'capture_motion':
      draft.images.push(await captureMotion(editor, draft, args))
      result = { image: draft.images.at(-1)?.label, mode: args.mode ?? 'animation' }
      break
    case 'apply_design': {
      const operations = args.operations as AIPlan['operations']
      await editor.userFonts.ensureLoaded()
      signal.throwIfAborted()
      const next = applyPlan(
        draft.doc,
        page.id,
        { message: '', operations },
        editor.userFonts.getSnapshot().families.map(({ family }) => family),
      )
      signal.throwIfAborted()
      draft.doc = next
      draft.operations.push(...operations)
      result = {
        layers: pageOf(draft).objects.map(({ id, type, name }) => ({ id, type, name })),
        totalLayers: pageOf(draft).objects.length,
      }
      break
    }
    default:
      throw new Error('Unknown design tool.')
  }
  signal.throwIfAborted()
  return { id: call.id, name: call.name, result }
}
