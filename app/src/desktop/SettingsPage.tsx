// Desktop settings: the library sidebar is replaced by a settings sidebar built from the same NavItem;
// the panel shows one section. "← Library" and Esc return to wherever Settings was opened from.
import { ArrowLeft } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { visibleSections } from '../compositions/settings'
import { PageHeader } from '../compositions/PageHeader'
import { navigate, type Route } from '../lib/router'
import { NavItem } from './Sidebar'
import s from './Sidebar.module.css'
import p from './SettingsPage.module.css'

let returnTo: Route = { name: 'home' }
export const rememberLibraryRoute = (r: Route) => { if (r.name !== 'settings') returnTo = r }
export const leaveSettings = () => navigate(returnTo)

export function SettingsSidebar({ section }: { section: string }) {
  const sections = visibleSections()
  const groups = [...new Set(sections.map((x) => x.group))]
  return (
    <aside className={s.sidebar} aria-label="Settings">
      <NavItem label="Library" icon={<ArrowLeft size={18} />} active={false} onClick={leaveSettings} />
      {groups.map((g) => (
        <div key={g} className={s.section}>
          <div className={s.sectionHead}><span>{g === 'Ream' ? '' : g}</span></div>
          <nav className={s.nav}>
            {sections.filter((x) => x.group === g).map((x) => (
              <NavItem key={x.id} label={x.label} icon={x.icon} active={x.id === section} onClick={() => navigate({ name: 'settings', section: x.id }, { replace: true })} />
            ))}
          </nav>
        </div>
      ))}
    </aside>
  )
}

export function SettingsContent({ section }: { section: string }) {
  const def = visibleSections().find((x) => x.id === section) ?? visibleSections()[0]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.documentElement.dataset.overlay && !(e.target as HTMLElement).matches('input, textarea')) leaveSettings()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={p.content}>
      <PageHeader title={def.label} />
      {def.render()}
    </div>
  )
}
