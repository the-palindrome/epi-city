import { describe, expect, it } from 'vitest'
import { validateTextureManifest } from './texture-manifest.js'

describe('texture manifest validation', () => {
  it('accepts bounded atlas frames', () => {
    expect(() => validateTextureManifest({
      name: 'test',
      tileSize: 32,
      atlas: { file: 'atlas.webp', width: 64, height: 64 },
      frames: [
        [0, 0, 32, 32],
        [32, 32, 32, 32]
      ]
    }, 'test')).not.toThrow()
  })

  it('rejects frames outside atlas bounds', () => {
    expect(() => validateTextureManifest({
      name: 'test',
      tileSize: 32,
      atlas: { file: 'atlas.webp', width: 64, height: 64 },
      frames: [
        [48, 48, 32, 32]
      ]
    }, 'test')).toThrow(/exceeds atlas bounds/)
  })
})
