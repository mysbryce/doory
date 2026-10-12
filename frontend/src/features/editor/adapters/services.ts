import { assetsApi, authApi, brandApi, commentsApi, designsApi, elementsApi, fontsApi, shareApi, stockApi, templatesApi } from '@/lib/api'
import type { Asset, BrandKit, BrandKitInput, Page } from '@/types/api'
import type { AssetRef, CommentViewer, EditorServices, UserFontsService } from '@/types/adapter'
import { aiApi } from '@/lib/api/ai'

/**
 * Tells the comments who is looking (`GET /auth/me/`). The answer is kept once there is one; a visitor who is not
 * signed in is asked again next time because they may sign in meanwhile. `owner`: the person owns the design.
 */
export function createViewerLookup(owner: boolean): () => Promise<CommentViewer | null> {
  let known: CommentViewer | null = null
  return async () => {
    if (known) return known
    const user = (await authApi.me()).user
    known = user ? { id: user.id, owner } : null
    return known
  }
}

export function assetToRef(asset: Asset): AssetRef {
  return { id: asset.id, url: asset.url, thumbUrl: asset.thumb_url, width: asset.width, height: asset.height, name: asset.name, kind: asset.kind }
}

type PublicServices = Pick<EditorServices, 'fonts' | 'elements' | 'templates' | 'ai'>

/** Catalog endpoints that need no login. */
export function createPublicServices(): PublicServices {
  return {
    ai: aiApi,
    fonts: { list: (query) => fontsApi.list(query) },
    elements: { packs: () => elementsApi.packs(), list: (query) => elementsApi.list(query) },
    templates: {
      categories: () => templatesApi.categories(),
      list: (query) => templatesApi.list(query),
      get: (slug) => templatesApi.get(slug),
    },
  }
}

/** The signed-in user's own font library (`/fonts/mine/`). */
export function createUserFontsService(): UserFontsService {
  return {
    list: () => fontsApi.mine(),
    upload: (input, options) => fontsApi.upload(input, options),
    remove: (id) => fontsApi.removeMine(id),
  }
}

function brandInput(kit: BrandKit): BrandKitInput {
  return { name: kit.name, is_default: kit.is_default, colors: kit.colors, fonts: kit.fonts, logo_ids: kit.logos.map((logo) => logo.id) }
}

export function createAccountAssetsService(): EditorServices['assets'] {
  return {
    list: (query): Promise<Page<Asset>> => assetsApi.list(query),
    remove: (id) => assetsApi.remove(id),
  }
}

/** Everything an authenticated user can reach from the editor. */
export function createAccountServices(designId: string | null, beforeVersion: () => Promise<void> = () => Promise.resolve()): EditorServices {
  const publicServices = createPublicServices()
  return {
    ...publicServices,
    fonts: { ...publicServices.fonts, mine: createUserFontsService() },
    assets: createAccountAssetsService(),
    brand: {
      list: () => brandApi.list(),
      save: (kit) => (kit.id ? brandApi.update(kit.id, brandInput(kit)) : brandApi.create(brandInput(kit))),
    },
    stock: {
      search: (query, page) => stockApi.search(query, page),
      importPhoto: async (photo) => assetToRef(await stockApi.importPhoto(photo)),
    },
    sharing: designId
      ? {
          list: () => shareApi.listLinks(designId),
          create: (input) => shareApi.createLink(designId, input),
          update: (id, patch) => shareApi.updateLink(designId, id, patch),
          revoke: (id) => shareApi.revokeLink(designId, id),
        }
      : null,
    comments: designId
      ? {
          list: () => commentsApi.list(designId),
          create: (input) => commentsApi.create(designId, input),
          resolve: (id, resolved) => commentsApi.resolve(designId, id, resolved),
          remove: (id) => commentsApi.remove(designId, id),
          move: (id, to) => commentsApi.move(designId, id, to),
          viewer: createViewerLookup(true),
        }
      : null,
    versions: designId
      ? {
          list: async () => (await designsApi.versions.list(designId)).results,
          create: async (label) => {
            await beforeVersion()
            return designsApi.versions.create(designId, label)
          },
          restore: async (versionId) => {
            await beforeVersion()
            return (await designsApi.versions.restore(designId, versionId)).document
          },
        }
      : null,
  }
}
