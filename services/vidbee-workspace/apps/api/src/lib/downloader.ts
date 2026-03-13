import path from 'node:path'
import type { DownloadRuntimeSettings, DownloadTask } from '@vidbee/downloader-core'
import { DownloaderCore } from '@vidbee/downloader-core'
import { HistoryStore } from './history-store'

const defaultDownloadDir =
  process.env.VIDBEE_DOWNLOAD_DIR?.trim() || process.env.DOWNLOAD_DIR?.trim() || undefined

const maxConcurrentValue = process.env.VIDBEE_MAX_CONCURRENT?.trim()
const parsedMaxConcurrent = maxConcurrentValue ? Number(maxConcurrentValue) : Number.NaN
const maxConcurrent =
  Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent > 0 ? parsedMaxConcurrent : undefined

const normalize = (value?: string): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const parseOptionalBoolean = (value?: string): boolean | undefined => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false
  }
  return undefined
}

const configuredHistoryStorePath = process.env.VIDBEE_HISTORY_STORE_PATH?.trim()
const historyStorePath = configuredHistoryStorePath
  ? configuredHistoryStorePath
  : defaultDownloadDir
    ? path.join(defaultDownloadDir, '.vidbee', 'vidbee.db')
    : path.join(process.cwd(), '.vidbee', 'vidbee.db')

const defaultRuntimeSettings: DownloadRuntimeSettings = {
  browserForCookies: normalize(process.env.VIDBEE_BROWSER_FOR_COOKIES),
  cookiesPath: normalize(process.env.VIDBEE_COOKIES_PATH),
  proxy:
    normalize(process.env.VIDBEE_PROXY) ||
    normalize(process.env.HTTPS_PROXY) ||
    normalize(process.env.HTTP_PROXY),
  configPath: normalize(process.env.VIDBEE_CONFIG_PATH),
  embedSubs: parseOptionalBoolean(process.env.VIDBEE_EMBED_SUBS),
  embedThumbnail: parseOptionalBoolean(process.env.VIDBEE_EMBED_THUMBNAIL),
  embedMetadata: parseOptionalBoolean(process.env.VIDBEE_EMBED_METADATA),
  embedChapters: parseOptionalBoolean(process.env.VIDBEE_EMBED_CHAPTERS)
}

export const historyStore = new HistoryStore(historyStorePath)

export const downloaderCore = new DownloaderCore({
  downloadDir: defaultDownloadDir,
  maxConcurrent,
  runtimeSettings: defaultRuntimeSettings
})

const terminalStatuses = new Set<DownloadTask['status']>(['completed', 'error', 'cancelled'])

downloaderCore.on('task-updated', (task: DownloadTask) => {
  if (!terminalStatuses.has(task.status)) {
    return
  }
  historyStore.save(task)
})
