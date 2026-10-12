import type { Anim, DocObject, ObjectEffects, PageBackground, PageTransition } from './document'

export interface AIProvider {
  id: string
  name: string
  protocol: 'chat' | 'responses' | 'anthropic' | 'gemini' | 'ollama' | 'cli'
  base_url: string
  enabled: boolean
  local: boolean
  server_key: boolean
  models: string[]
}

export interface AIConnection {
  provider: string
  api_key: string
  base_url?: string
  model: string
}

export interface AIOptions {
  speed: { id: string; label: string }[]
  effort: { id: string; label: string }[]
}

export interface AIContext {
  width: number
  height: number
  background: string
  objects: Record<string, unknown>[]
  selection: string[]
  transition?: PageTransition
  durationSec?: number
}

export type AIOperation =
  | { op: 'add'; object: Omit<DocObject, 'id'> & { type: 'rect' | 'ellipse' | 'triangle' | 'textbox' } }
  | { op: 'update'; id: string; props: Record<string, unknown> }
  | { op: 'delete'; id: string }
  | { op: 'background'; color: string }
  | { op: 'animation'; id: string; slot: 'enter' | 'exit' | 'emphasis'; value: Anim | null }
  | { op: 'transition'; value: PageTransition | null }
  | { op: 'duration'; seconds: number }
  | { op: 'effects'; id: string; value: ObjectEffects | null }
  | { op: 'background_style'; value: PageBackground }

export interface AIPlan {
  message: string
  operations: AIOperation[]
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AIResult {
  plan: AIPlan | null
  tool_calls?: AIToolCall[]
  message?: string
  actual_tier: string | null
  provider: string
  model: string
}

export interface AIToolCall {
  id: string
  name:
    | 'get_canvas'
    | 'inspect_layout'
    | 'inspect_styles'
    | 'get_motion_catalog'
    | 'inspect_motion'
    | 'capture_canvas'
    | 'capture_motion'
    | 'apply_design'
  arguments: Record<string, unknown>
}
export interface AIToolResult {
  id: string
  name: AIToolCall['name']
  result: unknown
}
export interface AIImage {
  label: string
  media_type: 'image/jpeg' | 'image/png'
  data: string
}
export interface AIToolDefinition {
  name: AIToolCall['name']
  description: string
  input_schema: Record<string, unknown>
}

export interface AIService {
  stream?(input: AIGenerateInput, signal: AbortSignal, onDelta: (text: string) => void): Promise<AIResult>
  tools?(signal?: AbortSignal): Promise<{ tools: AIToolDefinition[] }>
  providers(signal?: AbortSignal): Promise<{ self_hosted: boolean; providers: AIProvider[] }>
  models(connection: AIConnection, signal?: AbortSignal): Promise<AIOptions & { models: { id: string; name: string }[] }>
  options(connection: AIConnection, signal?: AbortSignal): Promise<AIOptions>
  generate(input: AIGenerateInput, signal?: AbortSignal): Promise<AIResult>
}

export interface AIGenerateInput extends AIConnection {
  prompt: string
  speed: string
  effort: string
  context: AIContext
  messages: AIMessage[]
  tool_results?: AIToolResult[]
  images?: AIImage[]
}
