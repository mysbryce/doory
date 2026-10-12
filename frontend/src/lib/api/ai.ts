import type { AIResult, AIService } from '@/types/ai'
import { http } from './client'

export const aiApi: AIService = {
  async stream(input, signal, onDelta) {
    const response = await http.postStream('/ai/stream/', { json: input, signal })
    if (!response.body) throw new Error('This browser cannot receive streamed answers.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        signal.throwIfAborted()
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n')
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          if (!line.trim()) continue
          const event = JSON.parse(line) as { type: string; text?: string; message?: string; result?: AIResult }
          if (event.type === 'delta' && typeof event.text === 'string') onDelta(event.text)
          else if (event.type === 'error') throw new Error(event.message || 'AI stream failed.')
          else if (event.type === 'result' && event.result) return event.result
        }
        if (done) throw new Error('AI stream ended before the design was complete.')
        if (buffer.length > 2 * 1024 * 1024) throw new Error('AI stream exceeded the size limit.')
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  },
  tools: (signal) => http.get('/ai/tools/', { signal }),
  providers: (signal) => http.get('/ai/providers/', { signal }),
  models: (connection, signal) => http.post('/ai/models/', { json: connection, signal }),
  options: (connection, signal) => http.post('/ai/options/', { json: connection, signal }),
  generate: (input, signal) => http.post('/ai/generate/', { json: input, signal }),
}
