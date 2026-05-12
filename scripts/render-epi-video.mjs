#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { build as buildVite } from 'vite'
import {
  decodeDataUrl,
  getPngPipeFfmpegInputArgs,
  getRawVideoFfmpegInputArgs,
  normalizeRgbaFramePayload
} from '../src/render/video-frame-transport.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const DEFAULT_FPS = 30
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080
const API_READY_TIMEOUT_MS = 240000
const PAGE_GOTO_TIMEOUT_MS = 60000

function printUsage() {
  console.log(`Usage:
  node scripts/render-epi-video.mjs --script ./scripts/epi-city-video.example.json [options]

Required:
  --script, -s       Path to Epi City JSON script

Options:
  --output, -o       Output video path (default: ./tmp/epi-city-video.mp4)
  --fps              Frames per second (default: 30)
  --width            Viewport width (default: 1920)
  --height           Viewport height (default: 1080)
  --url              Use an already-running playback URL (skips build/static server)
  --frames-dir       Directory for intermediate PNG frames
  --keep-frames      Keep PNG frames after ffmpeg completes
  --high-quality     Use lossless 4:4:4 encode settings (larger files)
  --chrome           Chromium/Chrome executable path
  --verbose, -v      Enable verbose diagnostics
  --help, -h         Show this help
`)
}

function parseArgs(argv) {
  const parsed = {
    output: path.resolve(projectRoot, 'tmp', 'epi-city-video.mp4'),
    fps: DEFAULT_FPS,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    url: null,
    scriptPath: null,
    framesDir: null,
    keepFrames: false,
    highQuality: false,
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
      case '--fps':
        parsed.fps = Number(next)
        index += 1
        break
      case '--width':
        parsed.width = Number(next)
        index += 1
        break
      case '--height':
        parsed.height = Number(next)
        index += 1
        break
      case '--url':
        parsed.url = next
        index += 1
        break
      case '--frames-dir':
        parsed.framesDir = path.resolve(next)
        index += 1
        break
      case '--keep-frames':
        parsed.keepFrames = true
        break
      case '--high-quality':
        parsed.highQuality = true
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

  validatePositiveNumber(parsed.fps, '--fps')
  validatePositiveNumber(parsed.width, '--width')
  validatePositiveNumber(parsed.height, '--height')

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

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'pipe'
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed (${command}): exit code ${code}`))
    })
  })
}

function getFfmpegVideoEncodeArgs({ highQuality }) {
  if (highQuality) {
    return [
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '0',
      '-pix_fmt', 'yuv444p',
      '-profile:v', 'high444',
      '-movflags', '+faststart'
    ]
  }

  return [
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart'
  ]
}

function startFfmpegEncoder(ffmpegPath, args) {
  const inputArgs = args.frameInputFormat === 'raw'
    ? getRawVideoFfmpegInputArgs(args)
    : getPngPipeFfmpegInputArgs(args)
  const videoFilters = args.frameInputFormat === 'raw'
    ? 'vflip,pad=ceil(iw/2)*2:ceil(ih/2)*2'
    : 'pad=ceil(iw/2)*2:ceil(ih/2)*2'

  const child = spawn(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel', 'warning',
    '-threads', '1',
    '-filter_threads', '1',
    ...inputArgs,
    '-vf', videoFilters,
    ...getFfmpegVideoEncodeArgs(args),
    args.output
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'inherit', 'inherit']
  })

  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed (${ffmpegPath}): exit code ${code}`))
    })
  })

  return {
    async writeFrame(frameBuffer) {
      if (!child.stdin || child.stdin.destroyed) {
        throw new Error('ffmpeg stdin closed before all frames were written.')
      }

      if (child.stdin.write(frameBuffer)) {
        return
      }

      await once(child.stdin, 'drain')
    },
    async finish() {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end()
      }

      await done
    },
    async abort() {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.destroy()
      }

      child.kill('SIGKILL')
      await done.catch(() => {})
    }
  }
}

async function resolveFfmpegPath() {
  try {
    await runCommand('ffmpeg', ['-version'], { stdio: 'ignore' })
    return 'ffmpeg'
  } catch {
    // Fall through.
  }

  try {
    const module = await import('ffmpeg-static')
    const ffmpegPath = module.default ?? module

    if (typeof ffmpegPath === 'string' && ffmpegPath.length > 0) {
      await fs.access(ffmpegPath, fsSync.constants.X_OK)
      return ffmpegPath
    }
  } catch {
    // Fall through.
  }

  throw new Error('ffmpeg is required but was not found in PATH, and ffmpeg-static is unavailable.')
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

function createProgressReporter({ logger, frameCount, fps }) {
  const startedAt = performance.now()
  const tty = process.stdout.isTTY
  let previousLineLength = 0

  return {
    tick(done) {
      const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000)
      const averageFps = done / elapsedSeconds
      const percent = frameCount > 0 ? (done / frameCount) * 100 : 100
      const remaining = Math.max(0, frameCount - done)
      const eta = averageFps > 0 ? `${(remaining / averageFps).toFixed(1)}s` : '--'
      const status = `frame ${done}/${frameCount} (${percent.toFixed(1)}%) | avg ${averageFps.toFixed(2)} fps | target ${fps} | eta ${eta}`

      if (tty) {
        process.stdout.write(`\r${status.padEnd(previousLineLength, ' ')}`)
        previousLineLength = Math.max(previousLineLength, status.length)
      } else {
        logger.info(status)
      }
    },
    finish(done) {
      this.tick(done)
      if (tty) {
        process.stdout.write('\n')
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const logger = makeLogger(args.verbose)

  if (args.help) {
    printUsage()
    return
  }

  if (!args.scriptPath) {
    printUsage()
    throw new Error('Missing required --script argument.')
  }

  const scriptPath = path.resolve(args.scriptPath)
  const scriptPayload = JSON.parse(await fs.readFile(scriptPath, 'utf8'))
  const ffmpegPath = await resolveFfmpegPath()
  const chromiumPath = await resolveChromiumPath(args.chromePath)

  await fs.mkdir(path.dirname(args.output), { recursive: true })

  const persistFrames = Boolean(args.framesDir || args.keepFrames)
  const frameRoot = persistFrames
    ? path.resolve(args.framesDir || path.join(projectRoot, 'tmp', `epi-city-video-frames-${Date.now()}`))
    : null

  const frameInputFormat = frameRoot ? 'png' : 'raw'

  if (frameRoot) {
    await fs.mkdir(frameRoot, { recursive: true })
    logger.info(`Frame directory: ${frameRoot}`)
  } else {
    logger.info('Frame output: streaming raw RGBA frames directly to ffmpeg.')
  }

  let localServer = null
  let browser = null
  let ffmpegEncoder = null

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
      viewport: {
        width: Math.round(args.width),
        height: Math.round(args.height)
      },
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

    logger.info(`Loading script: ${scriptPath}`)
    const summary = await page.evaluate((payload) => window.epiCityVideo.runScript(payload), scriptPayload)
    const duration = Number(summary?.duration ?? await page.evaluate(() => window.epiCityVideo.getDuration()))

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Invalid render duration returned by epiCityVideo API.')
    }

    const frameCount = Math.max(1, Math.floor(duration * args.fps) + 1)

    logger.info(`Duration: ${duration.toFixed(3)}s`)
    logger.info(`Recording: ${summary?.snapshotCount ?? '?'} snapshots over ${summary?.recordingDuration ?? '?'} simulation seconds`)
    logger.info(`Rendering ${frameCount} frame(s) at ${args.fps} fps...`)

    if (!frameRoot) {
      ffmpegEncoder = startFfmpegEncoder(ffmpegPath, {
        ...args,
        frameInputFormat
      })
    }

    const progress = createProgressReporter({ logger, frameCount, fps: args.fps })

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const renderSeconds = frameIndex / args.fps
      if (frameRoot) {
        const dataUrl = await page.evaluate(async (timeSeconds) => {
          await window.epiCityVideo.seek(timeSeconds)
          return window.epiCityVideo.captureFrame({ mimeType: 'image/png', render: false })
        }, renderSeconds)
        const pngBuffer = decodeDataUrl(dataUrl)

        if (pngBuffer.length === 0) {
          throw new Error(`Captured an empty PNG frame at index ${frameIndex}.`)
        }

        await fs.writeFile(path.join(frameRoot, `frame-${String(frameIndex).padStart(6, '0')}.png`), pngBuffer)
      } else {
        const rawFrame = await page.evaluate(async (timeSeconds) => {
          await window.epiCityVideo.seek(timeSeconds)
          return window.epiCityVideo.captureFrame({ format: 'rgba', render: false })
        }, renderSeconds)
        const { buffer } = normalizeRgbaFramePayload(rawFrame, {
          width: args.width,
          height: args.height,
          origin: 'bottom-left'
        })

        await ffmpegEncoder.writeFrame(buffer)
      }

      progress.tick(frameIndex + 1)
    }

    progress.finish(frameCount)

    if (ffmpegEncoder) {
      logger.info('Finalizing ffmpeg output...')
      await ffmpegEncoder.finish()
      ffmpegEncoder = null
    } else {
      logger.info('Encoding frame directory with ffmpeg...')
      await runCommand(ffmpegPath, [
        '-y',
        '-hide_banner',
        '-loglevel', 'warning',
        '-threads', '1',
        '-filter_threads', '1',
        '-framerate', String(args.fps),
        '-start_number', '0',
        '-i', path.join(frameRoot, 'frame-%06d.png'),
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        ...getFfmpegVideoEncodeArgs(args),
        args.output
      ], { stdio: 'inherit' })
    }

    logger.info(`Video written to ${args.output}`)

    if (frameRoot && !args.keepFrames) {
      await fs.rm(frameRoot, { recursive: true, force: true })
    }
  } finally {
    if (ffmpegEncoder) {
      await ffmpegEncoder.abort().catch(() => {})
    }

    if (browser) {
      await browser.close().catch(() => {})
    }

    if (localServer?.server) {
      await new Promise((resolve) => localServer.server.close(resolve))
    }
  }
}

function validatePositiveNumber(value, label) {
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
