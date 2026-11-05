// External file drops (DESIGN.md §6 Drop veil). Accepts .pptx anywhere over the content area,
// cards included; a folder under the pointer overrides the destination.
import { FileArrowUp, Prohibit } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { getLibrary, importFiles } from '../data/library'
import { toast } from '../data/toasts'
import { endDrag, getDnd, hasFiles, setOver, startExternal, useDnd } from './dnd'
import s from './DropVeil.module.css'

export function DropVeil({ destination, destinationName }: { destination: string | null; destinationName: string }) {
  const dnd = useDnd()
  const [allPptx, setAllPptx] = useState(true)

  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      startExternal()
      const items = [...(e.dataTransfer?.items ?? [])]
      setAllPptx(items.every((i) => i.kind !== 'file' || /presentationml|^$/.test(i.type)))
    }
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; endDrag() } }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      const folder = (e.target as HTMLElement).closest<HTMLElement>('[data-drop-folder]')?.dataset.dropFolder
      setOver(folder ?? null)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      const files = [...(e.dataTransfer?.files ?? [])]
      const target = getDnd().over
      endDrag()
      const pptx = files.filter((f) => /\.pptx$/i.test(f.name))
      const skipped = files.length - pptx.length
      if (pptx.length) importFiles(pptx, target === '' ? null : target ?? destination)
      if (skipped) toast({ message: skipped === files.length ? 'Only .pptx files can be imported for now' : `Skipped ${skipped} file${skipped === 1 ? '' : 's'} that aren’t .pptx` })
    }
    addEventListener('dragenter', enter)
    addEventListener('dragleave', leave)
    addEventListener('dragover', over)
    addEventListener('drop', drop)
    return () => {
      removeEventListener('dragenter', enter)
      removeEventListener('dragleave', leave)
      removeEventListener('dragover', over)
      removeEventListener('drop', drop)
    }
  }, [destination])

  const external = dnd.drag.kind === 'external'
  const overFolder = external && dnd.over ? getLibrary().entries[dnd.over]?.name : null
  return (
    <AnimatePresence>
      {external && (
        <motion.div
          className={s.veil}
          data-folder={overFolder ? true : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.16 } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <div className={`${s.card} glass`}>
            {allPptx ? <FileArrowUp size={22} /> : <Prohibit size={22} />}
            <span>{allPptx ? `Drop .pptx to import into ${overFolder ?? destinationName}` : 'Only .pptx files can be imported for now'}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
