import { PIXEL_ART_SCALE_MODE } from '../core/constants.js'

export function applyNearestSampling(texture) {
  const source = texture && texture.source

  if (!source) {
    return
  }

  source.scaleMode = PIXEL_ART_SCALE_MODE
  source.magFilter = PIXEL_ART_SCALE_MODE
  source.minFilter = PIXEL_ART_SCALE_MODE
  source.mipmapFilter = PIXEL_ART_SCALE_MODE
  source.autoGenerateMipmaps = false

  if (source.style && typeof source.style.update === 'function') {
    source.style.update()
  }
}
