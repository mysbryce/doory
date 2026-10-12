/** Decode only the human-readable message in a partially streamed JSON envelope. Never show raw edits. */
export function streamedMessage(buffer: string): string {
  const match = /"message"\s*:\s*"/.exec(buffer)
  if (!match) return ''
  const raw = buffer.slice(match.index + match[0].length)
  let text = ''
  const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (char === '"') break
    if (char !== '\\') {
      text += char
      continue
    }
    const next = raw[++i]
    if (!next) break
    if (next === 'u') {
      const code = raw.slice(i + 1, i + 5)
      if (!/^[0-9a-f]{4}$/i.test(code)) break
      text += String.fromCharCode(Number.parseInt(code, 16))
      i += 4
    } else text += escapes[next] ?? next
  }
  return text
}
