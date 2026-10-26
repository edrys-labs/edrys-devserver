import { watch } from 'chokidar'

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
