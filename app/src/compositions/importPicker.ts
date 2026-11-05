// The one way to pick .pptx files to import, used by every Import button in both shells.
import { importFiles } from '../data/library'

export function pickPptx(destination: string | null) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'
  input.onchange = () => {
    const files = [...(input.files ?? [])]
    if (files.length) importFiles(files, destination)
  }
  input.click()
}
