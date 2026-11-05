// Mobile rendering of the shared command inventory. The header shows the full, wrapping name and
// location so similar names can be told apart on touch (xhigh review #14).
import { getLibrary, pathTo } from '../data/library'
import { bytes, count, relTime } from '../lib/format'
import { Sheet, SheetActions, type SheetAction } from '../ui/Sheet'
import { commandsFor, type CommandContext } from './commands'
import { DeckThumb } from './DeckThumb'
import s from './ActionSheet.module.css'

export function ActionSheet({ ids, ctx, onClose }: { ids: string[]; ctx: Omit<CommandContext, 'touch'>; onClose: () => void }) {
  const lib = getLibrary()
  const entries = ids.map((i) => lib.entries[i]).filter(Boolean)
  if (!entries.length) return null
  const single = entries.length === 1 ? entries[0] : null
  const groups: SheetAction[][] = [[]]
  for (const it of commandsFor(ids, { ...ctx, touch: true })) {
    if (it.kind === 'sep') groups.push([])
    else if (it.kind === 'note') groups[groups.length - 1].push({ label: it.text, disabled: true, run: () => {} })
    else if (!it.kind || it.kind === 'item') groups[groups.length - 1].push({ label: it.label, icon: it.icon, danger: it.danger, disabled: it.disabled, run: it.run })
  }
  const where = single ? (single.parentId ? pathTo(lib, single.parentId).map((f) => f.name).join(' / ') : 'Files') : ''
  const header = (
    <div className={s.header}>
      {single?.type === 'deck' && <span className={s.thumb}><DeckThumb deck={single} /></span>}
      <div className={s.text}>
        <span className={s.name}>{single ? single.name : count(entries.length, 'item') + ' selected'}</span>
        {single && (
          <span className={s.meta}>
            {where}
            {single.type === 'deck' ? ` · ${count(single.slides.length, 'slide')} · ${bytes(single.sizeBytes)} · ${relTime(single.modifiedAt)}` : ''}
          </span>
        )}
      </div>
    </div>
  )
  return (
    <Sheet label={single ? `Actions for ${single.name}` : 'Actions'} onClose={onClose} header={header}>
      <SheetActions groups={groups} onDone={onClose} />
    </Sheet>
  )
}
