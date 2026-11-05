import { dropbox } from './dropbox'
import { google } from './google'
import { onedrive } from './onedrive'
import type { CloudDrive, ProviderId } from './types'

export const DRIVES: Record<ProviderId, CloudDrive> = { dropbox, google, onedrive }
export type { CloudAccount, CloudDrive, ProviderId } from './types'
