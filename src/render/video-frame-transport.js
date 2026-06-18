export const RGBA_BYTES_PER_PIXEL = 4

export function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('Expected captureFrame to return a data URL string.')
  }

  const match = /^data:(.+);base64,(.+)$/s.exec(dataUrl)

  if (!match) {
    throw new Error('Unexpected frame data URL payload.')
  }

  return Buffer.from(match[2], 'base64')
}

export function normalizeRgbaFramePayload(payload, expected = {}) {
  const width = Math.round(Number(payload?.width))
  const height = Math.round(Number(payload?.height))
  const pixels = payload?.pixels

  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Raw frame capture returned invalid dimensions.')
  }

  if (
    expected.width != null &&
    expected.height != null &&
    (width !== Math.round(Number(expected.width)) || height !== Math.round(Number(expected.height)))
  ) {
    throw new Error(`Raw frame dimensions ${width}x${height} did not match expected ${expected.width}x${expected.height}.`)
  }

  if (expected.origin && payload?.origin !== expected.origin) {
    throw new Error(`Raw frame origin ${payload?.origin || 'unknown'} did not match expected ${expected.origin}.`)
  }

  if (!pixels || typeof pixels.length !== 'number') {
    throw new Error('Raw frame capture did not return pixel bytes.')
  }

  const expectedBytes = width * height * RGBA_BYTES_PER_PIXEL

  if (pixels.length !== expectedBytes) {
    throw new Error(`Raw frame capture returned ${pixels.length} bytes, expected ${expectedBytes}.`)
  }

  return {
    width,
    height,
    origin: payload?.origin || null,
    buffer: Buffer.from(pixels)
  }
}

export function getPngPipeFfmpegInputArgs({ fps }) {
  return [
    '-f', 'png_pipe',
    '-framerate', String(fps),
    '-i', 'pipe:0'
  ]
}

export function getRawVideoFfmpegInputArgs({ fps, width, height }) {
  return [
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s:v', `${Math.round(width)}x${Math.round(height)}`,
    '-framerate', String(fps),
    '-i', 'pipe:0'
  ]
}
