import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AIPlan, AIResult, AIService } from '@/types/ai'
import { createBlankDocument } from '@/lib/document'
import { EditorEngine } from '../engine/editor'
import { EngineContext } from '../context'
import { createMemoryAdapter } from '../dev/memoryAdapter'
import { AIPanel } from './AIPanel'
import { sessionFor } from './session'

let engine: EditorEngine
const result: AIResult & { plan: AIPlan } = {
  provider: 'openrouter',
  model: 'test-model',
  actual_tier: null,
  plan: {
    message: 'A bold orange poster.',
    operations: [{ op: 'add', object: { type: 'rect', left: 20, top: 20, width: 200, height: 200, fill: '#ff8800' } }],
  },
}

function setup(generate: AIService['generate'] = vi.fn().mockResolvedValue(result)) {
  const service: AIService = {
    providers: vi.fn().mockResolvedValue({
      self_hosted: false,
      providers: [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          protocol: 'chat',
          base_url: 'https://openrouter.ai/api/v1',
          enabled: true,
          local: false,
          server_key: false,
          models: [],
        },
      ],
    }),
    models: vi.fn().mockResolvedValue({ models: [{ id: 'test-model', name: 'Test model' }], speed: [], effort: [] }),
    options: vi.fn().mockResolvedValue({ speed: [{ id: 'latency', label: 'Low latency' }], effort: [] }),
    generate,
  }
  const { adapter } = createMemoryAdapter()
  adapter.services.ai = service
  engine = new EditorEngine({
    adapter,
    document: createBlankDocument(800, 600),
    meta: { id: 'test', title: 'Test', mode: 'guest' },
    ephemeral: true,
  })
  vi.spyOn(engine.snapshots, 'get').mockResolvedValue('blob:preview')
  const show = () =>
    render(
      <EngineContext.Provider value={engine}>
        <AIPanel />
      </EngineContext.Provider>,
    )
  return { service, show }
}

async function enterConnection() {
  await userEvent.click(screen.getByRole('button', { name: 'Connection settings' }))
  await screen.findByRole('option', { name: 'OpenRouter' })
  await userEvent.type(screen.getByLabelText('API key'), 'session-key')
  await userEvent.type(screen.getByLabelText('Model'), 'test-model')
}

afterEach(() => {
  cleanup()
  engine?.dispose()
  vi.restoreAllMocks()
})

describe('AI sidebar flow', () => {
  it('generates a proposal, previews it and applies one undoable edit', async () => {
    const { show, service } = setup()
    show()
    await enterConnection()
    await userEvent.type(screen.getByLabelText('Design prompt'), 'Make a poster')
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }))
    await screen.findByText(result.plan.message)
    expect(engine.state.doc.pages[0].objects).toHaveLength(0)
    expect(service.generate).toHaveBeenCalledWith(
      expect.objectContaining({ api_key: 'session-key', prompt: 'Make a poster', speed: 'default' }),
      expect.any(AbortSignal),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Apply to canvas' }))
    await screen.findByText('Applied to canvas. Undo available.')
    expect(engine.state.doc.pages[0].objects).toHaveLength(1)
    await act(() => engine.undo())
    expect(engine.state.doc.pages[0].objects).toHaveLength(0)
  })

  it('blocks stale proposals after a concurrent canvas edit', async () => {
    const { show } = setup()
    show()
    await enterConnection()
    await userEvent.type(screen.getByLabelText('Design prompt'), 'Make a poster')
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }))
    await screen.findByText(result.plan.message)
    act(() => {
      engine.pages.setBackground(engine.state.activePageId, { type: 'solid', color: '#111111' })
    })
    expect(screen.getByRole('button', { name: 'Apply to canvas' })).toBeDisabled()
    expect(screen.getByText(/Canvas changed since/)).toBeInTheDocument()
  })

  it('retains credentials only in editor memory when the sidebar closes; clears on design switch', async () => {
    const { show } = setup()
    const first = show()
    await enterConnection()
    first.unmount()
    show()
    await screen.findByRole('option', { name: 'OpenRouter' })
    expect(screen.getByLabelText('API key')).toHaveValue('session-key')
    expect(localStorage.getItem('session-key')).toBeNull()
    engine.setDesignId('different')
    expect(sessionFor(engine).getState().keys).toEqual({})
  })

  it('ignores a provider result arriving after Stop waiting', async () => {
    let resolve!: (value: AIResult) => void
    const pending = new Promise<AIResult>((done) => {
      resolve = done
    })
    const { show } = setup(() => pending)
    show()
    await enterConnection()
    await userEvent.type(screen.getByLabelText('Design prompt'), 'Make a poster')
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }))
    await act(async () => {
      resolve(result)
      await pending
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply to canvas' })).toBeNull())
    expect(engine.state.doc.pages[0].objects).toHaveLength(0)
  })
})
