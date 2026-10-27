import fs from 'node:fs/promises'
import path from 'node:path'
import { watch } from 'chokidar'

/**
 * Reads `file`; while it is missing, tries again for up to `ms`: a save that
 * renames a copy over it, or deletes and writes it, leaves it gone a moment.
 */
export async function readSaved(file: string, ms = 500): Promise<string> {
  const end = Date.now() + ms
  for (;;) {
    try {
      return await fs.readFile(file, 'utf8')
    } catch (error: any) {
      if (error.code !== 'ENOENT' || Date.now() >= end) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

/**
 * Calls `onChange` once per save of `file`: editors often write a file in
 * several steps (truncate + write, or write a copy and rename it over).
 * Returns a function that stops watching.
 */
export function watchFile(file: string, onChange: () => void, delay = 100): () => Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const watcher = watch(file, { ignoreInitial: true })

  watcher.on('all', () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, delay)
  })

  return () => {
    clearTimeout(timer)
    return watcher.close()
  }
}

/**
 * Calls `onChange(name)` once per save in a folder `dir/<name>/`, i.e. per
 * module; files directly in `dir` are no module. Returns a function that
 * stops watching.
 */
export function watchModules(dir: string, onChange: (name: string) => void, delay = 100): () => Promise<void> {
  const timers = new Map<string, NodeJS.Timeout>()
  // hidden files and node_modules below dir; dir itself may sit in a hidden folder
  const ignored = (file: string) =>
    path
      .relative(dir, file)
      .split(path.sep)
      .some((part) => part.startsWith('.') || part === 'node_modules')
  const watcher = watch(dir, { ignoreInitial: true, ignored })

  watcher.on('all', (_event, file) => {
    const [name, ...rest] = path.relative(dir, file).split(path.sep)
    if (!name || !rest.length) return
    clearTimeout(timers.get(name))
    timers.set(name, setTimeout(() => onChange(name), delay))
  })

  return () => {
    timers.forEach(clearTimeout)
    return watcher.close()
  }
}
