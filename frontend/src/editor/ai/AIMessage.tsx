import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './AI.module.css'

/** Raw HTML and remote images are disabled; prose never becomes executable model output. */
export function AIMessage({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <div className={styles.markdown} data-streaming={streaming || undefined}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </Markdown>
      {streaming && <span className={styles.cursor} aria-hidden="true" />}
    </div>
  )
}
