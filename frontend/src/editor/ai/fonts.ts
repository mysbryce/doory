import inter from '@fontsource-variable/inter/metadata.json'
import jakarta from '@fontsource-variable/plus-jakarta-sans/metadata.json'
import nunito from '@fontsource-variable/nunito/metadata.json'
import fraunces from '@fontsource-variable/fraunces/metadata.json'
import caveat from '@fontsource-variable/caveat/metadata.json'
import type { FontCategory, FontFamily } from '@/types/api'
import type { EditorEngine } from '../engine/editor'
import { SYSTEM_FONTS } from '../engine/fonts'

type Source = 'catalog' | 'uploaded' | 'shared' | 'bundled' | 'system'
export interface DiscoveredFont {
  family: string
  category: FontCategory
  source: Source
  scripts: string[] | null
  declared_scripts?: string[]
  weights: number[] | null
  styles: string[] | null
  is_variable: boolean
  weight_range?: { min: number; max: number }
  variants?: { weight: number; style: string; scripts: string[] }[]
  coverage: 'installed-subsets' | 'font-metadata' | 'bundled-subsets' | 'device-dependent'
}

// Match the CSS imports in main.tsx, rather than advertise package styles the app does not load.
const bundled: DiscoveredFont[] = [
  [inter, ['normal']],
  [jakarta, ['normal']],
  [nunito, ['normal', 'italic']],
  [fraunces, ['normal', 'italic']],
  [caveat, ['normal']],
].map(([metadata, styles]) => {
  const font = metadata as typeof inter
  return {
    family: font.family,
    category: font.category as FontCategory,
    source: 'bundled',
    scripts: font.subsets,
    weights: font.weights.filter((weight) => weight <= 900),
    styles: styles as string[],
    is_variable: true,
    weight_range: { min: Number(font.variable.wght.min), max: Math.min(900, Number(font.variable.wght.max)) },
    coverage: 'bundled-subsets',
  }
})

function describe(font: FontFamily, source: Source): DiscoveredFont {
  const variants = font.variants.map((variant) => ({
    weight: variant.weight,
    style: variant.style,
    scripts: variant.subsets?.length
      ? [
          ...new Set(
            variant.subsets
              .filter(({ subset }) => subset === 'latin' || !!font.unicode_ranges?.[subset])
              .map(({ subset }) => subset),
          ),
        ]
      : [...font.scripts],
  }))
  return {
    family: font.family,
    category: font.category,
    source,
    is_variable: font.is_variable,
    scripts: [...new Set(variants.flatMap((variant) => variant.scripts))],
    declared_scripts: [...font.scripts],
    weights: [...new Set(variants.map(({ weight }) => weight))].sort((a, b) => a - b),
    styles: [...new Set(variants.map(({ style }) => style))],
    variants,
    coverage: source === 'catalog' ? 'installed-subsets' : 'font-metadata',
  }
}

/** Metadata only: never forward asset URLs, file bytes, owner IDs or private library IDs to a model. */
export async function searchFonts(editor: EditorEngine, args: Record<string, unknown>, signal: AbortSignal) {
  const query = String(args.query ?? '').trim(),
    script = args.script as string | undefined,
    category = args.category as FontCategory | undefined,
    source = args.source ?? 'all',
    page = Number(args.page ?? 1),
    size = Number(args.page_size ?? 20)
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 200 ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 40 ||
    query.length > 100 ||
    (script !== undefined && (script.length > 32 || !/^[a-z]+(?:-[a-z]+)?$/.test(script))) ||
    !['all', 'catalog', 'custom', 'bundled', 'system'].includes(String(source)) ||
    (category !== undefined && !['sans-serif', 'serif', 'display', 'handwriting', 'monospace'].includes(category))
  )
    throw new Error('Invalid font search filters.')
  const warnings = [
    'Script coverage is metadata, not proof that every glyph in your text exists. Variable ranges are limited to editor weights 100–900; custom/catalog ranges are unknown.',
  ]
  await editor.userFonts.ensureLoaded()
  signal.throwIfAborted()
  const custom = editor.userFonts.getSnapshot(),
    customNames = new Set(custom.families.map(({ family }) => family.toLowerCase()))
  if (custom.status === 'error') warnings.push('Custom font library could not be read. Custom results are incomplete.')
  let local: DiscoveredFont[] = []
  if (source === 'all' || source === 'custom')
    local.push(...custom.families.map((font) => describe(font, custom.source === 'shared' ? 'shared' : 'uploaded')))
  if (source === 'all' || source === 'bundled')
    local.push(...bundled.filter(({ family }) => !customNames.has(family.toLowerCase())))
  if (source === 'all' || source === 'system')
    local.push(
      ...SYSTEM_FONTS.filter(({ family }) => !customNames.has(family.toLowerCase())).map((font): DiscoveredFont => ({
        ...font,
        source: 'system',
        scripts: null,
        weights: null,
        styles: null,
        is_variable: false,
        coverage: 'device-dependent',
      })),
    )
  const matches = (font: DiscoveredFont) =>
    query
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 6)
      .every((word) => font.family.toLowerCase().includes(word)) &&
    (!category || font.category === category) &&
    (!script || !!font.scripts?.includes(script))
  local = local.filter(matches)
  let catalog: { candidate_count: number; next_page: number | null; fonts: DiscoveredFont[] } = {
    candidate_count: 0,
    next_page: null,
    fonts: [],
  }
  if (source === 'all' || source === 'catalog') {
    try {
      const response = await editor.adapter.services.fonts.list({
        q: query || undefined,
        script,
        category,
        page,
        page_size: size,
      })
      signal.throwIfAborted()
      const families = response.results.filter(({ family }) => !customNames.has(family.toLowerCase()))
      editor.fonts.remember(families)
      catalog = {
        candidate_count: response.count,
        next_page: response.next && page < 200 ? page + 1 : null,
        fonts: families
          .map((font) => describe(font, 'catalog'))
          .filter(matches)
          .slice(0, size),
      }
      if (response.results.some((font) => !matches(describe(font, 'catalog'))))
        warnings.push('Some catalog candidates do not have installed subsets for these filters. Continue pagination if needed.')
    } catch {
      signal.throwIfAborted()
      warnings.push('Font catalog could not be read. Catalog results are incomplete.')
    }
  }
  const result = {
    catalog,
    local: {
      count: local.length,
      next_page: page * size < local.length ? page + 1 : null,
      fonts: local.slice((page - 1) * size, page * size),
    },
    warnings,
  }
  if (JSON.stringify(result).length > 50000)
    throw new Error('Font search results exceed the context budget. Retry with a smaller page_size, query or script filter.')
  return result
}
