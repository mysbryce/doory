import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { Send, Settings2, Sparkles } from 'lucide-react'
import type { AIOptions, AIProvider, AIService } from '@/types/ai'
import { useEditor, useEditorState } from '../context'
import { pageSignature } from './operations'
import { runDesignAgent } from './agent'
import { sessionFor } from './session'
import { AIProposal } from './AIProposal'
import { AIMessage } from './AIMessage'
import { aiStrings as t } from './strings'
import styles from './AI.module.css'

const emptyOptions: AIOptions = { speed: [], effort: [] }
const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'AI request failed. Try again.')
const aborted = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'

export function AIPanel() {
  const editor = useEditor()
  useEditorState((state) => state.docVersion)
  const service = editor.adapter.services.ai
  return service ? <Assistant key={editor.designId} service={service} /> : null
}

function Assistant({ service }: { service: AIService }) {
  const editor = useEditor()
  const store = useMemo(() => sessionFor(editor), [editor])
  const session = useStore(store)
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [catalogEpoch, setCatalogEpoch] = useState(0)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [optionResult, setOptionResult] = useState<{ connection: typeof connection; options: AIOptions } | null>(null)
  const [speed, setSpeed] = useState('default')
  const [effort, setEffort] = useState('default')
  const [connecting, setConnecting] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const doc = useEditorState((state) => state.doc)
  const readOnly = useEditorState((state) => state.readOnly)
  const provider = providers.find((entry) => entry.id === session.providerId)
  const key = session.keys[session.providerId] ?? ''
  const connection = useMemo(
    () => ({ provider: session.providerId, api_key: key, model: session.model }),
    [session.providerId, key, session.model],
  )
  const options = optionResult?.connection === connection ? optionResult.options : emptyOptions
  const selectedSpeed = options.speed.some((option) => option.id === speed) ? speed : 'default'
  const selectedEffort = options.effort.some((option) => option.id === effort) ? effort : 'default'
  const ready = !!provider?.enabled && (provider.local || provider.server_key || !!key.trim())
  const sourcePage = doc.pages.find((page) => page.id === session.proposal?.pageId)
  const stale = !!session.proposal && (!sourcePage || pageSignature(doc, sourcePage) !== session.proposal.signature)

  useEffect(() => {
    const controller = new AbortController()
    service
      .providers(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setProviders(result.providers)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setCatalogError(errorText(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [service, catalogEpoch])

  useEffect(() => {
    const controller = new AbortController()
    if (!ready || !connection.model.trim()) return () => controller.abort()
    const timer = window.setTimeout(() => {
      service
        .options(connection, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setOptionResult({ connection, options: result })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) store.setState({ error: errorText(error) })
        })
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [service, connection, ready, store])

  useEffect(
    () => () => {
      operation.current?.abort()
      store.setState({ busy: false })
    },
    [store],
  )

  useEffect(() => {
    const node = conversation.current
    if (node) node.scrollTop = node.scrollHeight
  }, [session.messages.length, session.busy, session.proposal, session.streaming])

  async function connect() {
    const controller = new AbortController()
    operation.current = controller
    setConnecting(true)
    store.setState({ error: '', notice: '' })
    try {
      const result = await service.models(connection, controller.signal)
      if (controller.signal.aborted) return
      setModels(result.models)
      setOptionResult({ connection, options: result })
      store.setState({ notice: t.connected })
    } catch (error) {
      if (!aborted(error)) store.setState({ error: errorText(error) })
    } finally {
      if (!controller.signal.aborted) setConnecting(false)
    }
  }

  async function generate() {
    const prompt = session.prompt.trim()
    if (!prompt || !ready || session.busy || connecting || readOnly) return
    const page = editor.state.doc.pages.find((entry) => entry.id === editor.state.activePageId)
    if (!page) return
    const controller = new AbortController()
    operation.current = controller
    const messages = session.messages.slice(-18)
    store.setState({
      busy: true,
      setup: false,
      error: '',
      notice: '',
      streaming: '',
      proposal: null,
      prompt: '',
      messages: [...messages, { role: 'user', content: prompt }],
    })
    try {
      const proposal = await runDesignAgent(
        editor,
        service,
        { ...connection, prompt, messages, speed: selectedSpeed, effort: selectedEffort },
        controller.signal,
        (progress) => store.setState({ progress }),
        (streaming) => store.setState({ streaming }),
      )
      if (controller.signal.aborted) return
      store.setState((state) => ({
        proposal,
        messages: [...state.messages, { role: 'assistant', content: proposal.plan.message }],
      }))
    } catch (error) {
      if (!aborted(error)) store.setState({ error: errorText(error), prompt })
    } finally {
      if (!controller.signal.aborted) store.setState({ busy: false, streaming: '' })
    }
  }

  async function apply() {
    const proposal = store.getState().proposal
    if (!proposal || readOnly) return
    const latest = editor.state.doc
    const page = latest.pages.find((entry) => entry.id === proposal.pageId)
    if (!page || pageSignature(latest, page) !== proposal.signature) {
      store.setState({ error: t.stale })
      return
    }
    // Disable application until every layer can be built. Recheck after fonts/load work yields.
    store.setState({ busy: true, error: '' })
    const controller = new AbortController()
    operation.current = controller
    try {
      const prepared = proposal.preview.pages.find((entry) => entry.id === page.id)!
      await editor.loadContext.ensureFonts(
        prepared.objects
          .filter((object) => object.type === 'textbox')
          .map((object) => ({
            family: String(object.fontFamily ?? 'Inter'),
            weight: String(object.fontWeight ?? 400),
            style: String(object.fontStyle ?? 'normal'),
            chars: String(object.text ?? ''),
          })),
      )
      const currentDoc = editor.state.doc
      const currentPage = currentDoc.pages.find((entry) => entry.id === page.id)
      if (controller.signal.aborted) return
      if (editor.readOnly || !currentPage || pageSignature(currentDoc, currentPage) !== proposal.signature)
        throw new Error(t.stale)
      editor.applyDocument(
        { ...currentDoc, pages: currentDoc.pages.map((entry) => (entry.id === page.id ? prepared : entry)) },
        { label: 'AI design', activePageId: page.id },
      )
      editor.announce(t.applied)
      store.setState((state) => ({
        proposal: null,
        notice: t.applied,
        messages: [...state.messages, { role: 'assistant', content: '[Applied to canvas]' }],
      }))
    } catch (error) {
      store.setState({ error: errorText(error) })
    } finally {
      store.setState({ busy: false })
    }
  }

  function stop() {
    operation.current?.abort()
    setConnecting(false)
    store.setState({ busy: false, notice: t.stopping })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <span>
          <Sparkles size={14} aria-hidden="true" /> {t.intro}
        </span>
        <button
          type="button"
          aria-label={t.setup}
          aria-expanded={session.setup}
          onClick={() => store.setState({ setup: !session.setup })}
        >
          <Settings2 size={16} />
        </button>
      </div>
      {loading && <p role="status">Loading providers…</p>}
      {catalogError && (
        <div role="alert">
          <p>{catalogError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              setCatalogError('')
              setCatalogEpoch((value) => value + 1)
            }}
          >
            Retry connection
          </button>
        </div>
      )}
      {session.setup && (
        <fieldset className={styles.connection} disabled={session.busy || connecting}>
          <label>
            {t.provider}
            <select
              aria-label={t.provider}
              value={session.providerId}
              onChange={(event) => {
                const selected = providers.find((entry) => entry.id === event.target.value)
                store.setState({
                  providerId: event.target.value,
                  model: selected?.models[0] ?? (selected?.protocol === 'cli' ? 'default' : ''),
                  error: '',
                  notice: '',
                })
                setModels([])
                setSpeed('default')
                setEffort('default')
              }}
            >
              {providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {entry.enabled ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.model}
            <input
              aria-label={t.model}
              list="doory-ai-models"
              value={session.model}
              placeholder={provider?.protocol === 'cli' ? 'default' : 'Exact model ID'}
              onChange={(event) => store.setState({ model: event.target.value, error: '' })}
            />
          </label>
          <datalist id="doory-ai-models">
            {(models.length ? models : (provider?.models ?? []).map((id) => ({ id, name: id }))).map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
          {session.setup && (
            <>
              <p className={styles.note}>{t.modelHelp}</p>
              {provider?.protocol !== 'cli' && (
                <label>
                  {t.key}
                  <input
                    type="password"
                    aria-label={t.key}
                    autoComplete="off"
                    spellCheck={false}
                    value={key}
                    placeholder={provider?.server_key ? 'Use configured server key' : 'Your provider API key'}
                    onChange={(event) =>
                      store.setState({ keys: { ...session.keys, [session.providerId]: event.target.value }, error: '' })
                    }
                  />
                </label>
              )}
              {provider?.base_url && (
                <label>
                  {t.endpoint}
                  <input aria-label={t.endpoint} value={provider.base_url} readOnly />
                </label>
              )}
              <p className={styles.note}>{provider?.protocol === 'cli' ? t.localHelp : t.keyHelp}</p>
              {!provider?.base_url && provider?.protocol !== 'cli' && <p className={styles.note}>{t.endpointHelp}</p>}
              <button type="button" className={styles.secondary} disabled={!ready} onClick={() => void connect()}>
                {t.connect}
              </button>
            </>
          )}
          {provider && !provider.enabled && <p className={styles.note}>{t.disabled}</p>}
          <div className={styles.options}>
            <label>
              {t.speed}
              <select
                aria-label={t.speed}
                disabled={!options.speed.length}
                value={selectedSpeed}
                onChange={(event) => setSpeed(event.target.value)}
              >
                <option value="default">{t.default}</option>
                {options.speed.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.effort}
              <select
                aria-label={t.effort}
                disabled={!options.effort.length}
                value={selectedEffort}
                onChange={(event) => setEffort(event.target.value)}
              >
                <option value="default">{t.default}</option>
                {options.effort.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(options.speed.length > 0 || options.effort.length > 0) && <p className={styles.note}>{t.tierHelp}</p>}
        </fieldset>
      )}
      <div ref={conversation} className={styles.conversation} role="log" aria-label={t.history} aria-live="polite">
        {!session.messages.length && (
          <div className={styles.empty}>
            <Sparkles size={28} aria-hidden="true" />
            <p>{t.subtext}</p>
            {!ready && (
              <button type="button" className={styles.secondary} onClick={() => store.setState({ setup: true })}>
                Connect your AI
              </button>
            )}
            {t.suggestions.map((prompt) => (
              <button type="button" key={prompt} onClick={() => store.setState({ prompt })}>
                {prompt}
              </button>
            ))}
          </div>
        )}
        {session.messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? styles.user : styles.assistant}>
            {message.role === 'assistant' ? <AIMessage content={message.content} /> : message.content}
          </div>
        ))}
        {session.busy && session.streaming && (
          <div className={styles.assistant}>
            <AIMessage content={session.streaming} streaming />
          </div>
        )}
        {session.busy && <p role="status">{session.progress || t.working}</p>}
        {session.proposal && (
          <div className={styles.proposal}>
            <AIProposal proposal={session.proposal} />
          </div>
        )}
      </div>
      {session.proposal && (
        <div className={styles.review}>
          <p className={styles.note}>{stale ? t.stale : t.pending}</p>
          {session.proposal.actualTier && <p className={styles.note}>{t.actualTier(session.proposal.actualTier)}</p>}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={stale || session.busy || readOnly}
              onClick={() => void apply()}
            >
              {t.apply}
            </button>
            <button type="button" disabled={session.busy} onClick={() => store.setState({ proposal: null, notice: t.discarded })}>
              {t.discard}
            </button>
          </div>
        </div>
      )}
      {session.error && (
        <p className={styles.error} role="alert">
          {session.error}
        </p>
      )}
      {session.notice && (
        <p className={styles.note} role="status">
          {session.notice}
        </p>
      )}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault()
          void generate()
        }}
      >
        <textarea
          aria-label="Design prompt"
          placeholder={t.prompt}
          value={session.prompt}
          maxLength={8000}
          rows={3}
          disabled={session.busy || readOnly}
          onChange={(event) => store.setState({ prompt: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void generate()
            }
          }}
        />
        <div className={styles.actions}>
          {session.busy || connecting ? (
            <button type="button" onClick={stop}>
              {t.stop}
            </button>
          ) : (
            <button
              type="submit"
              className={styles.primary}
              disabled={!ready || !session.model.trim() || !session.prompt.trim() || readOnly}
            >
              <Send size={14} aria-hidden="true" /> {t.send}
            </button>
          )}
          <button
            type="button"
            disabled={session.busy || connecting}
            onClick={() => store.setState({ messages: [], proposal: null, error: '', notice: '' })}
          >
            {t.clear}
          </button>
        </div>
        <p className={styles.note}>{t.privacy}</p>
      </form>
    </div>
  )
}
