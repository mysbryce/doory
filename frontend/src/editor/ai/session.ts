import { createStore } from 'zustand/vanilla'
import type { AIMessage, AIPlan } from '@/types/ai'
import type { DoryDocument } from '@/types/document'
import type { EditorEngine } from '../engine/editor'

export interface Proposal {
  plan: AIPlan
  pageId: string
  signature: string
  preview: DoryDocument
  actualTier: string | null
}

export interface AISession {
  providerId: string
  model: string
  keys: Record<string, string>
  messages: AIMessage[]
  proposal: Proposal | null
  prompt: string
  setup: boolean
  busy: boolean
  progress: string
  streaming: string
  error: string
  notice: string
}

const sessions = new WeakMap<EditorEngine, { designId: string; store: ReturnType<typeof createAISession> }>()

export function createAISession() {
  return createStore<AISession>(() => ({
    providerId: 'openrouter',
    model: '',
    keys: {},
    messages: [],
    proposal: null,
    prompt: '',
    setup: false,
    busy: false,
    progress: '',
    streaming: '',
    error: '',
    notice: '',
  }))
}

/** Credentials and chat survive closing the tool, but never leave the editor's memory. */
export function sessionFor(editor: EditorEngine) {
  let session = sessions.get(editor)
  if (!session || session.designId !== editor.designId) {
    session = { designId: editor.designId, store: createAISession() }
    sessions.set(editor, session)
  }
  return session.store
}
