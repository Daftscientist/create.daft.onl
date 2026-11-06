// Edit a chart's data in a grid (PowerPoint's "Edit Data", without the spreadsheet window):
// categories down the side, one column per series. Arrow keys and Enter move between cells.
import { Plus, Trash } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button, IconButton } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { setChart, type ChartSpec } from './chart'
import s from './ChartData.module.css'

export function ChartData({ id, spec, onClose }: { id: string; spec: ChartSpec; onClose: () => void }) {
  const [cats, setCats] = useState(spec.categories)
  const [series, setSeries] = useState(spec.series.map((x) => ({ ...x, text: x.values.map(String) })))
  const pie = spec.type === 'pie'
  const bad = series.some((x) => x.text.some((t) => t.trim() === '' || !Number.isFinite(Number(t)) || (pie && Number(t) < 0)))
  const save = () => {
    if (bad) return
    setChart(id, { ...spec, categories: cats, series: series.map(({ text, ...x }) => ({ ...x, values: text.map(Number) })) })
    onClose()
  }
  const move = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const [r, c] = (e.currentTarget.dataset.cell ?? '0,0').split(',').map(Number)
    const go = (dr: number, dc: number) => { e.preventDefault(); e.currentTarget.closest('table')?.querySelector<HTMLInputElement>(`[data-cell="${r + dr},${c + dc}"]`)?.focus() }
    if (e.key === 'Enter' || e.key === 'ArrowDown') go(1, 0)
    else if (e.key === 'ArrowUp') go(-1, 0)
    else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length) go(0, 1)
    else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) go(0, -1)
  }
  return (
    <Dialog title="Chart data" width={640} onClose={onClose} actions={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={bad} onClick={save}>Save</Button>
    </>}>
      <div className={s.wrap}>
        <table className={s.grid}>
          <thead>
            <tr>
              <th />
              {series.map((x, si) => (
                <th key={si}>
                  <span className={s.head}>
                    <input aria-label={`Series ${si + 1} name`} value={x.name} onChange={(e) => setSeries(series.map((y, j) => (j === si ? { ...y, name: e.target.value } : y)))} />
                    {series.length > 1 && <IconButton label="Remove series" size="sm" tone="plain" onClick={() => setSeries(series.filter((_, j) => j !== si))}><Trash size={13} /></IconButton>}
                  </span>
                </th>
              ))}
              {!pie && <th><IconButton label="Add series" size="sm" tone="plain" onClick={() => setSeries([...series, { name: `Series ${series.length + 1}`, values: [], text: cats.map(() => '0') }])}><Plus size={13} /></IconButton></th>}
            </tr>
          </thead>
          <tbody>
            {cats.map((c, ci) => (
              <tr key={ci}>
                <th>
                  <span className={s.head}>
                    <input aria-label={`Category ${ci + 1}`} data-cell={`${ci},0`} value={c} onKeyDown={move} onChange={(e) => setCats(cats.map((x, j) => (j === ci ? e.target.value : x)))} />
                    {cats.length > 1 && <IconButton label="Remove category" size="sm" tone="plain" onClick={() => { setCats(cats.filter((_, j) => j !== ci)); setSeries(series.map((x) => ({ ...x, text: x.text.filter((_, j) => j !== ci) }))) }}><Trash size={13} /></IconButton>}
                  </span>
                </th>
                {series.map((x, si) => {
                  const t = x.text[ci] ?? ''
                  const invalid = t.trim() === '' || !Number.isFinite(Number(t)) || (pie && Number(t) < 0)
                  return <td key={si}><input inputMode="decimal" aria-label={`${x.name}, ${c}`} aria-invalid={invalid || undefined} data-cell={`${ci},${si + 1}`} value={t} onKeyDown={move} onChange={(e) => setSeries(series.map((y, j) => (j === si ? { ...y, text: y.text.map((v, k) => (k === ci ? e.target.value : v)) } : y)))} /></td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <Button variant="ghost" icon={<Plus size={14} />} onClick={() => { setCats([...cats, `Item ${cats.length + 1}`]); setSeries(series.map((x) => ({ ...x, text: [...x.text, '0'] }))) }}>Add category</Button>
        {bad && <p className={s.error} role="alert">{pie ? 'Every value needs to be a number of zero or more (a pie can’t show negatives).' : 'Every value needs to be a number.'}</p>}
      </div>
    </Dialog>
  )
}
