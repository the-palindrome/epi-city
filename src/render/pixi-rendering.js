import * as PIXI from 'pixi.js'
import { PIXEL_ART_SCALE_MODE, TEXTURE_SET_PATHS } from '../core/constants.js'
import { validateTextureManifest } from './texture-manifest.js'
import { applyNearestSampling } from './texture-sampling.js'

export function configurePixelArtRendering() {
  if (PIXI.TextureStyle && PIXI.TextureStyle.defaultOptions) {
    PIXI.TextureStyle.defaultOptions.scaleMode = PIXEL_ART_SCALE_MODE
    PIXI.TextureStyle.defaultOptions.magFilter = PIXEL_ART_SCALE_MODE
    PIXI.TextureStyle.defaultOptions.minFilter = PIXEL_ART_SCALE_MODE
    PIXI.TextureStyle.defaultOptions.mipmapFilter = PIXEL_ART_SCALE_MODE
  }

  if (PIXI.TextureSource && PIXI.TextureSource.defaultOptions) {
    PIXI.TextureSource.defaultOptions.scaleMode = PIXEL_ART_SCALE_MODE
    PIXI.TextureSource.defaultOptions.autoGenerateMipmaps = false
  }
}

export async function loadTextureSet(name) {
  if (!name) {
    return null
  }

  const manifestUrl = TEXTURE_SET_PATHS[name]

  if (!manifestUrl) {
    throw new Error(`Unknown texture set "${name}".`)
  }

  const response = await fetch(manifestUrl)

  if (!response.ok) {
    throw new Error(`Could not load ${manifestUrl}: ${response.status} ${response.statusText}`)
  }

  const manifest = await response.json()
  validateTextureManifest(manifest, name)

  const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)
  const atlasTexture = await PIXI.Assets.load(baseUrl + manifest.atlas.file)

  applyNearestSampling(atlasTexture)

  const textureCache = new Array(manifest.frames.length)

  function getTexture(id) {
    if (!Number.isInteger(id) || id < 0 || id >= manifest.frames.length) {
      return null
    }

    if (!textureCache[id]) {
      const frame = manifest.frames[id]
      textureCache[id] = new PIXI.Texture({
        source: atlasTexture.source,
        frame: new PIXI.Rectangle(frame[0], frame[1], frame[2], frame[3])
      })
      applyNearestSampling(textureCache[id])
    }

    return textureCache[id]
  }

  return {
    name: manifest.name || name,
    tileSize: manifest.tileSize,
    atlas: atlasTexture,
    atlasImage: atlasTexture.source?.resource || null,
    frames: manifest.frames,
    getTexture
  }
}

export function clearPixiContainer(container) {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true })
  }
}

export function fillRect(graphics, x, y, width, height, color, alpha = 1) {
  graphics.rect(x, y, width, height).fill({ color, alpha })
}
