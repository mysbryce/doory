import type { AIConnection, AIMessage, AIService, AIToolCall, AIToolResult } from '@/types/ai'
import type { EditorEngine } from '../engine/editor'
import { pageContext, pageSignature } from './operations'
import { executeDesignTool, type Draft } from './tools'
import type { Proposal } from './session'
import { streamedMessage } from './streamMessage'

export const MAX_AGENT_TURNS = 8

/** Provider-neutral tool loop. Every round carries measured data and real rendered images. */
export async function runDesignAgent(
  editor: EditorEngine,
  service: AIService,
  input: AIConnection & { prompt: string; speed: string; effort: string; messages: AIMessage[] },
  signal: AbortSignal,
  onProgress: (message: string) => void,
  onStreaming: (message: string) => void = () => {},
): Promise<Proposal> {
  const initial = editor.state.doc,
    source = initial.pages.find((page) => page.id === editor.state.activePageId)!
  const signature = pageSignature(initial, source)
  const draft: Draft = { doc: initial, pageId: source.id, selection: [...editor.state.selection.ids], operations: [], images: [] }
  let toolResults: AIToolResult[] = []
  const history = [...input.messages]
  let verifiedSignature = '',
    actualTier: string | null = null
  async function execute(calls: AIToolCall[]) {
    draft.images = []
    const results: AIToolResult[] = []
    for (const call of calls) {
      signal.throwIfAborted()
      onProgress(`Using ${call.name.replaceAll('_', ' ')}…`)
      try {
        results.push(await executeDesignTool(editor, draft, call, signal))
      } catch (error) {
        signal.throwIfAborted()
        results.push({ id: call.id, name: call.name, result: { error: error instanceof Error ? error.message : 'Tool failed.' } })
      }
    }
    return results
  }
  if (service.tools) {
    // Verify the server and client agree on the tool protocol before making any billable call.
    const definitions = await service.tools(signal)
    if (!definitions.tools.some((tool) => tool.name === 'capture_canvas'))
      throw new Error('AI design tools are unavailable on this server.')
    toolResults = await execute(
      ['get_canvas', 'inspect_layout', 'inspect_styles', 'inspect_motion', 'search_fonts']
        .filter((name) => name !== 'search_fonts' || definitions.tools.some((tool) => tool.name === name))
        .map((name, index) => ({
          id: `baseline-${index}`,
          name: name as AIToolCall['name'],
          arguments: {},
        })),
    )
  }
  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    signal.throwIfAborted()
    const page = draft.doc.pages.find((entry) => entry.id === draft.pageId)!
    onProgress(turn === 0 ? 'Designing…' : `Reviewing draft · turn ${turn + 1}/${MAX_AGENT_TURNS}…`)
    const request = {
      ...input,
      messages: history.slice(-18),
      context: pageContext(
        draft.doc,
        page,
        draft.selection.filter((id) => page.objects.some((object) => object.id === id)),
      ),
      tool_results: toolResults,
      images: draft.images.slice(-3),
    }
    let buffer = ''
    onStreaming('')
    const response = service.stream
      ? await service.stream(request, signal, (delta) => {
          buffer += delta
          onStreaming(streamedMessage(buffer))
        })
      : await service.generate(request, signal)
    signal.throwIfAborted()
    actualTier = response.actual_tier ?? actualTier
    if (response.tool_calls?.length) {
      if (response.tool_calls.length > 8) throw new Error('AI requested too many tools.')
      history.push({ role: 'assistant', content: JSON.stringify({ tool_calls: response.tool_calls }).slice(0, 8000) })
      toolResults = await execute(response.tool_calls)
      continue
    }
    if (!response.plan) throw new Error('AI returned no design or tool request.')
    if (response.plan.operations.length) {
      const applied = await execute([
        { id: `final-${turn}`, name: 'apply_design', arguments: { operations: response.plan.operations } },
      ])
      if ((applied[0].result as { error?: string }).error) throw new Error((applied[0].result as { error: string }).error)
      // Failed mutation must not become a silently empty or incomplete proposal.
      if (
        pageSignature(
          draft.doc,
          draft.doc.pages.find((entry) => entry.id === draft.pageId)!,
        ) === signature
      )
        throw new Error('AI returned no applicable design changes.')
    }
    const candidate = draft.doc.pages.find((entry) => entry.id === draft.pageId)!
    const currentSignature = pageSignature(draft.doc, candidate)
    if (currentSignature === signature) throw new Error('AI returned no design changes. Ask for a specific edit.')
    if (service.tools && verifiedSignature !== currentSignature) {
      const calls: AIToolCall[] = ['inspect_layout', 'inspect_styles', 'inspect_motion', 'capture_canvas'].map((name, index) => ({
        id: `audit-${turn}-${index}`,
        name: name as AIToolCall['name'],
        arguments: {},
      }))
      if (candidate.objects.some((object) => object.animation))
        calls.push({ id: `motion-${turn}`, name: 'capture_motion', arguments: { mode: 'animation' } })
      if (candidate.transition && initial.pages.findIndex((entry) => entry.id === candidate.id) > 0)
        calls.push({ id: `transition-${turn}`, name: 'capture_motion', arguments: { mode: 'transition' } })
      toolResults = await execute(calls)
      if (!draft.images.length)
        throw new Error('Could not render a preview for AI visual verification. Your canvas is unchanged.')
      verifiedSignature = currentSignature
      history.push(
        { role: 'assistant', content: response.plan.message },
        {
          role: 'user',
          content:
            'Draft edits applied. Inspect attached audit images and tool results. Fix issues or finish with operations: []. Do not repeat applied edits. State any failed verification.',
        },
      )
      continue
    }
    return {
      plan: { message: response.plan.message, operations: draft.operations },
      pageId: source.id,
      signature,
      preview: draft.doc,
      actualTier,
    }
  }
  throw new Error('AI reached the review limit. Narrow your request and generate again.')
}
