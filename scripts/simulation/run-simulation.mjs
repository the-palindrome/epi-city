#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { build as buildVite } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')

const API_READY_TIMEOUT_MS = 240000
const PAGE_GOTO_TIMEOUT_MS = 60000

function printUsage() {
  console.log(`Usage:
  node scripts/simulation/run-simulation.mjs --script ./scripts/render/epi-city-video.example.json --output ./tmp/epi-city-recording.json [options]

Required:
  --script, -s              Path to Epi City JSON script/preset

Options:
  --output, -o              Output recording JSON path (default: ./tmp/epi-city-recording.json)
  --duration-days <number>  Override simulation duration in game days
  --duration-hours <number> Override simulation duration in game hours
  --duration-seconds <num>  Override simulation duration in game seconds
  --sample-interval <num>   Override recording sample interval in game seconds
  --step <number>           Override simulation generation step in game seconds
  --url <url>               Use an already-running playback URL (skips build/static server)
  --chrome <path>           Chromium/Chrome executable path
  --verbose, -v             Enable verbose diagnostics
  --help, -h                Show this help
`)
}

function parseArgs(argv) {
  const parsed = {
    scriptPath: null,
    output: path.resolve(projectRoot, 'tmp', 'epi-city-recording.json'),
    durationDays: null,
    durationHours: null,
    durationSeconds: null,
    sampleInterval: null,
    step: null,
    url: null,
    chromePath: null,
    verbose: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true
        break
      case '--script':
      case '-s':
        parsed.scriptPath = next
        index += 1
        break
      case '--output':
      case '-o':
        parsed.output = path.resolve(next)
        index += 1
        break
      case '--duration-days':
        parsed.durationDays = Number(next)
        index += 1
        break
      case '--duration-hours':
        parsed.durationHours = Number(next)
        index += 1
        break
      case '--duration-seconds':
        parsed.durationSeconds = Number(next)
        index += 1
        break
      case '--sample-interval':
        parsed.sampleInterval = Number(next)
        index += 1
        break
      case '--step':
        parsed.step = Number(next)
        index += 1
        break
      case '--url':
        parsed.url = next
        index += 1
        break
      case '--chrome':
        parsed.chromePath = next
        index += 1
        break
      case '--verbose':
      case '-v':
        parsed.verbose = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (parsed.help) {
    return parsed
  }

  if (!parsed.scriptPath) {
    throw new Error('Missing required --script argument.')
  }

  validateOptionalPositiveNumber(parsed.durationDays, '--duration-days')
  validateOptionalPositiveNumber(parsed.durationHours, '--duration-hours')
  validateOptionalPositiveNumber(parsed.durationSeconds, '--duration-seconds')
  validateOptionalPositiveNumber(parsed.sampleInterval, '--sample-interval')
  validateOptionalPositiveNumber(parsed.step, '--step')

  const durationOverrideCount = [
    parsed.durationDays,
    parsed.durationHours,
    parsed.durationSeconds
  ].filter((value) => value != null).length

  if (durationOverrideCount > 1) {
    throw new Error('Use only one of --duration-days, --duration-hours, or --duration-seconds.')
  }

  return parsed
}

function makeLogger(verbose) {
  const stamp = () => new Date().toISOString()
  const line = (level, message) => `[${stamp()}] [${level}] ${message}`

  return {
    info(message) {
      console.log(line('info', message))
    },
    warn(message) {
      console.warn(line('warn', message))
    },
    debug(message) {
      if (verbose) {
        console.log(line('debug', message))
      }
    }
  }
}

async function resolveChromiumPath(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsSync.constants.X_OK)
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase()

  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.webp':
      return 'image/webp'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

async function startStaticPlaybackServer(rootDir, logger) {
  const root = path.resolve(rootDir)
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost')
      const requestPath = decodeURIComponent(url.pathname)
      const relativePath = requestPath === '/'
        ? 'index.html'
        : requestPath.replace(/^\/+/, '')
      const filePath = path.resolve(root, relativePath)
      const relativeFromRoot = path.relative(root, filePath)

      if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Forbidden')
        return
      }

      const info = await fs.stat(filePath).catch(() => null)

      if (!info?.isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Not found')
        return
      }

      response.writeHead(200, { 'content-type': getMimeType(filePath) })
      createReadStream(filePath).pipe(response)
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Internal server error')
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine local playback server URL.')
  }

  const playbackUrl = `http://127.0.0.1:${address.port}/playback.html`

  logger.info(`Local playback server: ${playbackUrl}`)
  return { server, url: playbackUrl }
}

async function buildPlaybackApp(logger) {
  logger.info('Building Epi City playback app...')
  await buildVite({
    configFile: path.resolve(projectRoot, 'vite.config.ts'),
    root: projectRoot,
    logLevel: 'silent'
  })
}

function applySimulationOverrides(scriptPayload, args) {
  const script = Array.isArray(scriptPayload)
    ? { script: scriptPayload }
    : { ...scriptPayload }
  const simulation = {
    ...(script.simulation || {})
  }

  if (args.durationDays != null) {
    simulation.durationSeconds = args.durationDays * 24 * 60 * 60
    delete simulation.duration
    delete simulation.durationHours
  } else if (args.durationHours != null) {
    simulation.durationSeconds = args.durationHours * 60 * 60
    delete simulation.duration
    delete simulation.durationHours
  } else if (args.durationSeconds != null) {
    simulation.durationSeconds = args.durationSeconds
    delete simulation.duration
    delete simulation.durationHours
  }

  if (args.sampleInterval != null) {
    simulation.sampleIntervalSeconds = args.sampleInterval
    delete simulation.sampleInterval
  }

  if (args.step != null) {
    simulation.stepSeconds = args.step
    delete simulation.step
  }

  script.simulation = simulation
  return script
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const logger = makeLogger(args.verbose)

  if (args.help) {
    printUsage()
    return
  }

  const scriptPath = path.resolve(args.scriptPath)
  const scriptPayload = applySimulationOverrides(
    JSON.parse(await fs.readFile(scriptPath, 'utf8')),
    args
  )
  const chromiumPath = await resolveChromiumPath(args.chromePath)

  await fs.mkdir(path.dirname(args.output), { recursive: true })

  let localServer = null
  let browser = null

  try {
    if (!args.url) {
      await buildPlaybackApp(logger)
      localServer = await startStaticPlaybackServer(path.resolve(projectRoot, 'dist'), logger)
    }

    const pageUrl = args.url || localServer.url
    const launchOptions = {
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--ignore-gpu-blocklist',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader'
      ]
    }

    if (chromiumPath) {
      launchOptions.executablePath = chromiumPath
      logger.info(`Using Chromium executable: ${chromiumPath}`)
    } else {
      logger.warn('No Chrome/Chromium executable found. Trying Playwright default browser lookup.')
    }

    browser = await chromium.launch(launchOptions)
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    })

    page.on('pageerror', (error) => logger.warn(`Page error: ${formatError(error)}`))
    page.on('console', (message) => {
      if (args.verbose) {
        logger.debug(`Page console [${message.type()}] ${message.text()}`)
      }
    })
    page.on('requestfailed', (request) => {
      logger.warn(`Request failed ${request.method()} ${request.url()}: ${request.failure()?.errorText || 'unknown'}`)
    })

    logger.info(`Opening playback page: ${pageUrl}`)
    await page.goto(pageUrl, { waitUntil: 'commit', timeout: PAGE_GOTO_TIMEOUT_MS })
    await page.waitForFunction(
      () => window.epiCityVideo && typeof window.epiCityVideo.runScript === 'function',
      null,
      { timeout: API_READY_TIMEOUT_MS }
    )

    logger.info(`Generating simulation recording from: ${scriptPath}`)
    const summary = await page.evaluate((payload) => window.epiCityVideo.runScript(payload), scriptPayload)
    const bundle = await page.evaluate(() => window.epiCityVideo.getRecordingBundle())

    if (!bundle?.recording?.snapshots?.length) {
      throw new Error('Playback page did not return a simulation recording.')
    }

    await fs.writeFile(args.output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
    logger.info(`Recording: ${summary.snapshotCount} snapshots over ${summary.recordingDuration} simulation seconds`)
    logger.info(`Recording written to ${args.output}`)
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }

    if (localServer?.server) {
      await new Promise((resolve) => localServer.server.close(resolve))
    }
  }
}

function validateOptionalPositiveNumber(value, label) {
  if (value == null) {
    return
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`)
  }
}

function formatError(error) {
  return error?.stack || error?.message || String(error)
}

main().catch((error) => {
  console.error(formatError(error))
  process.exitCode = 1
})
