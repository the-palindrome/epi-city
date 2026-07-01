export function createProgressBar({
  label,
  stream = process.stderr,
  width = 32,
  minIntervalMs = 100
}) {
  const startedAt = performance.now()
  const isTty = Boolean(stream.isTTY)
  let lastRenderAt = 0
  let lastLineLength = 0
  let lastBucket = -1
  let currentProgress = 0
  let currentMessage = ''

  function render(progress, message = currentMessage, force = false) {
    currentProgress = clampProgress(progress)
    currentMessage = message || ''

    const now = performance.now()
    const bucket = Math.floor(currentProgress * 20)

    if (!force) {
      if (isTty && now - lastRenderAt < minIntervalMs) {
        return
      }

      if (!isTty && bucket === lastBucket) {
        return
      }
    }

    lastRenderAt = now
    lastBucket = bucket

    const filled = Math.round(currentProgress * width)
    const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`
    const percent = `${Math.round(currentProgress * 100)}`.padStart(3, ' ')
    const elapsed = formatSeconds((now - startedAt) / 1000)
    const suffix = currentMessage ? ` ${currentMessage}` : ''
    const line = `${label} [${bar}] ${percent}% ${elapsed}${suffix}`

    if (isTty) {
      stream.write(`\r${line.padEnd(lastLineLength, ' ')}`)
      lastLineLength = Math.max(lastLineLength, line.length)
      return
    }

    stream.write(`${line}\n`)
  }

  return {
    start(message = '') {
      render(0, message, true)
    },
    update(progress, message = '') {
      render(progress, message, false)
    },
    finish(message = 'Done') {
      render(1, message, true)
      if (isTty) {
        stream.write('\n')
      }
    },
    fail(message = 'Failed') {
      render(currentProgress, message, true)
      if (isTty) {
        stream.write('\n')
      }
    }
  }
}

function clampProgress(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 0
  }

  return Math.min(Math.max(number, 0), 1)
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0.0s'
  }

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)

  return `${minutes}m ${String(remainder).padStart(2, '0')}s`
}
