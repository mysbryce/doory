import { LayoutTemplate, Layers, Music, PaintBucket, Palette, Sparkles } from 'lucide-react'
import { I } from '../chrome/icons'
import { ImageDrawer } from '../drawers/ImageDrawer'
import { ShapesDrawer } from '../drawers/ShapesDrawer'
import { TextDrawer } from '../drawers/TextDrawer'
import { BackgroundPanel } from '../panels/BackgroundPanel'
import { CommentsButtonIcon } from '../panels/CommentsButtonIcon'
import { LayersPanel } from '../panels/LayersPanel'
import { registerPanel } from '../panels/registry'
import { StickerPanel } from '../panels/StickerPanel'
import { t } from '../strings'
import { loadable } from '../ui/loadable'
import { LazyCommentPins } from '../workspace/CommentPinsLoader'

// Tools that most sessions never open live in chunks of their own: the top-bar button starts
// the download when it is hovered or focused, so the panel is usually there by the time it is clicked.
const TemplatesPanel = loadable(() => import('../panels/TemplatesPanel').then((m) => m.TemplatesPanel))
const BrandPanel = loadable(() => import('../panels/BrandPanel').then((m) => m.BrandPanel))
const AnimatePanel = loadable(() => import('../panels/AnimatePanel').then((m) => m.AnimatePanel))
const AudioPanel = loadable(() => import('../panels/AudioPanel').then((m) => m.AudioPanel))
const CommentsPanel = loadable(() => import('../panels/CommentsPanel').then((m) => m.CommentsPanel))
const AIPanel = loadable(() => import('../ai/AIPanel').then((m) => m.AIPanel))

/**
 * The tools of the top bar: Text, Sticker, Image and Shapes first, then the rest. Text, Image, Shapes and Background open as drawers under their button;
 * Sticker, Templates, Brand and Layers dock at the left of the workspace; Comments is an icon at the right end.
 */
export function registerBuiltinPanels(): void {
  const editable = ({ state }: { state: { readOnly: boolean } }): boolean => !state.readOnly
  registerPanel({ id: 'ai', label: 'AI designer', icon: <Sparkles size={18} aria-hidden="true" />, order: 5, placement: 'sidebar', component: AIPanel, preload: AIPanel.preload, requires: ({ editor, state }) => !state.readOnly && !!editor.adapter.services.ai })
  registerPanel({ id: 'text', label: t.rail.text, icon: I.text, order: 10, placement: 'drawer', component: TextDrawer, requires: editable, shortcut: 'T' })
  registerPanel({ id: 'elements', label: t.rail.elements, title: t.stickers.title, icon: I.sticker, order: 20, placement: 'sidebar', component: StickerPanel, requires: editable })
  registerPanel({ id: 'image', label: t.rail.image, icon: I.image, order: 30, placement: 'drawer', component: ImageDrawer, requires: editable })
  registerPanel({ id: 'shapes', label: t.rail.shapes, icon: I.shapes, order: 40, placement: 'drawer', component: ShapesDrawer, requires: editable })
  registerPanel({ id: 'templates', label: t.rail.templates, icon: <LayoutTemplate size={18} aria-hidden="true" />, order: 50, placement: 'sidebar', component: TemplatesPanel, preload: TemplatesPanel.preload, requires: editable })
  registerPanel({ id: 'background', label: t.rail.background, icon: <PaintBucket size={18} aria-hidden="true" />, order: 60, placement: 'drawer', component: BackgroundPanel, requires: editable })
  registerPanel({ id: 'brand', label: t.rail.brand, icon: <Palette size={18} aria-hidden="true" />, order: 70, placement: 'sidebar', component: BrandPanel, preload: BrandPanel.preload, requires: ({ state }) => !state.readOnly && state.mode !== 'shared-edit' })
  registerPanel({ id: 'animate', label: t.animation.panel.title, icon: <Sparkles size={18} aria-hidden="true" />, order: 75, placement: 'sidebar', component: AnimatePanel, preload: AnimatePanel.preload, requires: editable })
  registerPanel({ id: 'audio', label: t.rail.audio, title: t.audio.title, icon: <Music size={18} aria-hidden="true" />, order: 76, placement: 'sidebar', component: AudioPanel, preload: AudioPanel.preload, readOnly: true })
  registerPanel({ id: 'layers', label: t.rail.layers, icon: <Layers size={18} aria-hidden="true" />, order: 80, placement: 'sidebar', component: LayersPanel, readOnly: true })
  registerPanel({
    id: 'comments',
    label: t.rail.comments,
    icon: <CommentsButtonIcon />,
    order: 90,
    placement: 'sidebar',
    slot: 'end',
    readOnly: true,
    component: CommentsPanel,
    preload: () => void Promise.all([CommentsPanel.preload(), LazyCommentPins.preload()]),
    requires: ({ editor, state }) => state.mode !== 'shared-view' && (!!editor.adapter.services.comments || state.mode === 'guest' || state.mode === 'shared-comment'),
  })
}

registerBuiltinPanels()
