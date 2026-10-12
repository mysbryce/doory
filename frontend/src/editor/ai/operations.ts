import { newId } from '@/lib/document'
import type { AIContext, AIPlan } from '@/types/ai'
import type { DocObject, DocPage, DoryDocument } from '@/types/document'
import { pageSize } from '../engine/docOps'
import { normalizeAnim, normalizeTransition } from '../animation/model'
import { emphasisPresets, inOutPresets, transitionPresets } from '../animation/presets'
import '../animation/builtins'
import { fontStack, primaryFamily } from '../engine/text/fontStack'

const fields = [
  'name',
  'text',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'lineHeight',
  'charSpacing',
  'underline',
  'overline',
  'linethrough',
  'strokeUniform',
  'scaleX',
  'scaleY',
  'skewX',
  'skewY',
  'left',
  'top',
  'width',
  'height',
  'angle',
  'opacity',
  'fill',
  'stroke',
  'strokeWidth',
  'rx',
  'ry',
]
const types = new Set(['rect', 'ellipse', 'triangle', 'textbox'])
const color = /^(#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})|transparent|none)$/

function designFont(value: unknown, customFamilies: readonly string[]): string {
  const name = primaryFamily(typeof value === 'string' ? value : 'Inter')
  if (customFamilies.some((family) => family.toLowerCase() === name.toLowerCase())) return fontStack(name, undefined)
  const bundled: Record<string, 'sans-serif' | 'serif' | 'handwriting'> = {
    Inter: 'sans-serif',
    Nunito: 'sans-serif',
    'Plus Jakarta Sans': 'sans-serif',
    Fraunces: 'serif',
    Caveat: 'handwriting',
  }
  return name in bundled ? `"${name} Variable", ${fontStack(name, bundled[name])}` : fontStack(name, undefined)
}

/** Send only design data: never asset URLs, links, arbitrary metadata or other pages. */
export function pageContext(doc: DoryDocument, page: DocPage, selection: readonly string[]): AIContext {
  const size = pageSize(doc, page)
  const objects = page.objects.map((object) => {
    const clean: Record<string, unknown> = { id: object.id, type: object.type, locked: object.locked === true }
    for (const field of fields) {
      const value = object[field]
      if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
        clean[field] = value
    }
    for (const field of ['originX', 'originY', 'scaleX', 'scaleY']) {
      const value = object[field]
      if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) clean[field] = value
    }
    if (object.animation) clean.animation = structuredClone(object.animation)
    if (object.effects) clean.effects = structuredClone(object.effects)
    return clean
  })
  return {
    ...size,
    background: page.background.type === 'solid' ? page.background.color : page.background.type,
    objects,
    selection: [...selection],
    ...(page.transition ? { transition: page.transition } : {}),
    ...(page.durationSec !== undefined ? { durationSec: page.durationSec } : {}),
  }
}

/** Include dimensions: a concurrent resize must invalidate a pending proposal too. */
export function pageSignature(doc: DoryDocument, page: DocPage): string {
  return JSON.stringify({ size: pageSize(doc, page), page })
}

function checkProps(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (!fields.includes(key)) throw new Error('AI returned unsupported object properties.')
    if (typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new Error('AI returned invalid object properties.')
    if ((key === 'fill' || key === 'stroke') && (typeof value !== 'string' || !color.test(value)))
      throw new Error('AI returned an invalid color.')
  }
}

/** Pure atomic page edit. Fresh ids; preserve other pages, locked layers, background metadata and history. */
export function applyPlan(doc: DoryDocument, pageId: string, plan: AIPlan, customFamilies: readonly string[] = []): DoryDocument {
  const page = doc.pages.find((entry) => entry.id === pageId)
  if (!page) throw new Error('The source page no longer exists.')
  if (!Array.isArray(plan.operations) || plan.operations.length > 100) throw new Error('AI returned too many edits.')
  let objects = [...page.objects]
  let background = page.background
  let transition = page.transition
  let durationSec = page.durationSec
  for (const operation of plan.operations) {
    if (operation.op === 'background') {
      if (!color.test(operation.color)) throw new Error('AI returned an invalid background.')
      background = { type: 'solid', color: operation.color }
    } else if (operation.op === 'add') {
      const { type, ...props } = operation.object
      if (!types.has(type)) throw new Error('AI returned an unsupported layer type.')
      checkProps(props)
      // Fabric 7 defaults to center origins. The design edit contract uses top-left coordinates.
      const object: DocObject = { ...props, type, id: newId(), originX: 'left', originY: 'top' }
      if (type === 'ellipse') {
        object.rx = Number(props.width) / 2
        object.ry = Number(props.height) / 2
      }
      if (type === 'textbox') {
        object.fontFamily = designFont(object.fontFamily, customFamilies)
        object.fontSize ??= 32
        object.fontWeight ??= 400
      }
      objects.push(object)
    } else if (operation.op === 'update' || operation.op === 'delete') {
      const target = objects.find((object) => object.id === operation.id)
      if (!target || target.locked) throw new Error('AI tried to change an unavailable or locked layer.')
      if (operation.op === 'delete') objects = objects.filter((object) => object.id !== operation.id)
      else {
        checkProps(operation.props)
        const edited = { ...target, ...operation.props }
        if (operation.props.fontFamily !== undefined) edited.fontFamily = designFont(operation.props.fontFamily, customFamilies)
        if (target.type === 'ellipse') {
          if (operation.props.width !== undefined) edited.rx = Number(operation.props.width) / 2
          if (operation.props.height !== undefined) edited.ry = Number(operation.props.height) / 2
        }
        objects = objects.map((object) => (object.id === target.id ? edited : object))
      }
    } else if (operation.op === 'animation') {
      const target = objects.find((object) => object.id === operation.id)
      if (!target || target.locked) throw new Error('AI tried to animate a locked or missing layer.')
      const anim = operation.value === null ? null : normalizeAnim(operation.value)
      const registry = operation.slot === 'emphasis' ? emphasisPresets : inOutPresets
      if (operation.value !== null && (!anim || !registry.has(anim.preset)))
        throw new Error('AI chose an unregistered animation.')
      const animation = { ...((target.animation as Record<string, unknown>) ?? {}) }
      if (anim) animation[operation.slot] = anim
      else delete animation[operation.slot]
      objects = objects.map((object) => (object.id === target.id ? { ...object, animation } : object))
    } else if (operation.op === 'transition') {
      const value = operation.value === null ? null : normalizeTransition(operation.value)
      if (operation.value !== null && (!value || !transitionPresets.has(value.preset)))
        throw new Error('AI chose an unregistered transition.')
      transition = value ?? undefined
    } else if (operation.op === 'duration') {
      if (!Number.isFinite(operation.seconds) || operation.seconds < 0.1 || operation.seconds > 600)
        throw new Error('Invalid page duration.')
      durationSec = operation.seconds
    } else if (operation.op === 'effects') {
      const target = objects.find((object) => object.id === operation.id)
      if (!target || target.locked) throw new Error('AI tried to style a locked or missing layer.')
      objects = objects.map((object) => (object.id === target.id ? { ...object, effects: operation.value ?? undefined } : object))
    } else if (operation.op === 'background_style') {
      if (operation.value.type === 'image') throw new Error('AI cannot attach external background images.')
      background = operation.value
    } else throw new Error('AI returned an unknown edit operation.')
  }
  if (objects.length > 500) throw new Error('AI supports up to 500 layers per page.')
  return {
    ...doc,
    pages: doc.pages.map((entry) => (entry.id === pageId ? { ...page, background, objects, transition, durationSec } : entry)),
  }
}
