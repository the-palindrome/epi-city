import { describe, expect, it } from 'vitest'
import { validateTextureManifest } from './texture-manifest.js'
import { applyNearestSampling } from './texture-sampling.js'

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

describe('texture sampling', () => {
  it('applies nearest-neighbor sampling to texture sources', () => {
    const texture = {
      source: {
        style: {
          updateCount: 0,
          update() {
            this.updateCount += 1
          }
        }
      }
    }

    applyNearestSampling(texture)

    expect(texture.source.scaleMode).toBe('nearest')
    expect(texture.source.magFilter).toBe('nearest')
    expect(texture.source.minFilter).toBe('nearest')
    expect(texture.source.mipmapFilter).toBe('nearest')
    expect(texture.source.autoGenerateMipmaps).toBe(false)
    expect(texture.source.style.updateCount).toBe(1)
  })
})
