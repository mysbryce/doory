import { render, screen } from '@testing-library/react'
import { streamedMessage } from './streamMessage'
import { AIMessage } from './AIMessage'

it('decodes a partial human message without exposing tool JSON or partial Unicode escapes', () => {
  expect(streamedMessage('{"message":"Hello **wo')).toBe('Hello **wo')
  expect(streamedMessage('{"message":"Line\\nTwo\\u0e')).toBe('Line\nTwo')
  expect(streamedMessage('{"message":"Ready","operations":[{"op":"delete"}]}')).toBe('Ready')
  expect(streamedMessage('{"tool_calls":[')).toBe('')
})

it('renders Markdown answers, blocks HTML and does not fetch remote images', () => {
  const { container } = render(
    <AIMessage
      content={
        '## Ready\n\n**Poster** made.\n\n- Good spacing\n- Motion checked\n\n<script>alert(1)</script>\n\n![track](https://evil.example/pixel)'
      }
    />,
  )
  expect(screen.getByRole('heading', { name: 'Ready' })).toBeInTheDocument()
  expect(container.querySelector('strong')).toHaveTextContent('Poster')
  expect(container.querySelectorAll('li')).toHaveLength(2)
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('img')).toBeNull()
})
