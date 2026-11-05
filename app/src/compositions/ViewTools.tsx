// Sort menu + grid/list toggle. Every collection header uses this pair.
import { CaretDown, Check, ListBullets, SquaresFour } from '@phosphor-icons/react'
import { useState } from 'react'
import { SORT_LABEL, type Prefs, type SortKey } from '../lib/prefs'
import { Button } from '../ui/Button'
import { Menu, type MenuAnchor } from '../ui/Menu'
import { Segmented } from '../ui/Segmented'

export function ViewTools({ prefs, onChange, sorts = ['opened', 'modified', 'name'] }: {
  prefs: Prefs
  onChange: (p: Partial<Prefs>) => void
  sorts?: SortKey[]
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  return (
    <>
      <Button
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        trailing={<CaretDown size={12} />}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAnchor({ x: r.right, y: r.bottom + 6, align: 'end' }) }}
      >
        {SORT_LABEL[prefs.sort]}
      </Button>
      <Segmented
        label="View"
        value={prefs.view}
        onChange={(view) => onChange({ view })}
        options={[
          { value: 'grid', title: 'Grid view', label: <SquaresFour size={16} /> },
          { value: 'list', title: 'List view', label: <ListBullets size={16} /> },
        ]}
      />
      <Menu
        open={!!anchor}
        anchor={anchor}
        label="Sort by"
        onClose={() => setAnchor(null)}
        items={sorts.map((k) => ({
          label: SORT_LABEL[k],
          icon: prefs.sort === k ? <Check size={14} weight="bold" /> : null,
          run: () => onChange({ sort: k }),
        }))}
      />
    </>
  )
}
