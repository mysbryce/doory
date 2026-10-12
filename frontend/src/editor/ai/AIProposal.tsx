import { useEffect, useState } from 'react'
import type { Proposal } from './session'
import { useEditor } from '../context'
import { pageSize } from '../engine/docOps'
import { aiStrings as t } from './strings'
import styles from './AI.module.css'

/** Render with Doory's own Fabric snapshot path: preview and final canvas use the same fonts and shapes. */
export function AIProposal({ proposal }: { proposal: Proposal }) {
  const editor = useEditor()
  const [preview, setPreview] = useState<{ proposal: Proposal; url: string } | null>(null)
  const [failed, setFailed] = useState<Proposal | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const page = proposal.preview.pages.find((entry) => entry.id === proposal.pageId)!
    editor.snapshots
      .get(page, pageSize(proposal.preview, page), controller.signal)
      .then((url) => {
        if (!controller.signal.aborted) setPreview({ proposal, url })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(proposal)
      })
    return () => controller.abort()
  }, [editor, proposal])
  return (
    <figure className={styles.preview}>
      {preview?.proposal === proposal && preview.url ? (
        <img src={preview.url} alt={t.preview} />
      ) : (
        <p>{failed === proposal ? 'Preview unavailable. Generate again.' : 'Rendering preview…'}</p>
      )}
      <figcaption>{t.edits(proposal.plan.operations.length)}</figcaption>
    </figure>
  )
}
