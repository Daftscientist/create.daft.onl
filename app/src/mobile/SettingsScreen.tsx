// Mobile settings: a grouped list that pushes to each section (iOS Settings convention).
import { visibleSections } from '../compositions/settings'
import { back, navigate } from '../lib/router'
import { BackButton } from '../ui/Button'
import { LargeTitle } from '../ui/LargeTitle'
import { ListGroup, ListRow } from '../ui/List'

export function SettingsScreen({ section }: { section: string | null }) {
  const sections = visibleSections()
  const def = section ? sections.find((x) => x.id === section) : null
  if (def) {
    return (
      <LargeTitle title={def.label} leading={<BackButton label="Settings" onClick={back} />}>
        {def.render()}
      </LargeTitle>
    )
  }
  const groups = [...new Set(sections.map((x) => x.group))]
  return (
    <LargeTitle title="Settings" leading={<BackButton label="Files" onClick={back} />}>
      {groups.map((g) => (
        <ListGroup key={g} title={g === 'Ream' ? undefined : g}>
          {sections.filter((x) => x.group === g).map((x) => (
            <ListRow key={x.id} icon={x.icon} label={x.label} onClick={() => navigate({ name: 'settings', section: x.id })} />
          ))}
        </ListGroup>
      ))}
    </LargeTitle>
  )
}
