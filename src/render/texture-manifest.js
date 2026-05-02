export function validateTextureManifest(manifest, fallbackName = 'texture set') {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Texture set "${fallbackName}" manifest must be a JSON object.`)
  }

  if (!Number.isInteger(manifest.tileSize) || manifest.tileSize <= 0) {
    throw new Error(`Texture set "${fallbackName}" manifest tileSize must be a positive integer.`)
  }

  if (!manifest.atlas || typeof manifest.atlas !== 'object' || Array.isArray(manifest.atlas)) {
    throw new Error(`Texture set "${fallbackName}" manifest must include an atlas object.`)
  }

  if (typeof manifest.atlas.file !== 'string' || manifest.atlas.file.length === 0) {
    throw new Error(`Texture set "${fallbackName}" atlas.file must be a non-empty string.`)
  }

  if (!Number.isInteger(manifest.atlas.width) || manifest.atlas.width <= 0) {
    throw new Error(`Texture set "${fallbackName}" atlas.width must be a positive integer.`)
  }

  if (!Number.isInteger(manifest.atlas.height) || manifest.atlas.height <= 0) {
    throw new Error(`Texture set "${fallbackName}" atlas.height must be a positive integer.`)
  }

  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) {
    throw new Error(`Texture set "${fallbackName}" must include atlas frames.`)
  }

  for (let index = 0; index < manifest.frames.length; index += 1) {
    const frame = manifest.frames[index]

    if (!Array.isArray(frame) || frame.length !== 4 || frame.some((value) => !Number.isInteger(value))) {
      throw new Error(`Texture set "${fallbackName}" frame ${index} must be [x, y, width, height].`)
    }

    const [x, y, width, height] = frame

    if (x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new Error(`Texture set "${fallbackName}" frame ${index} has invalid bounds.`)
    }

    if (x + width > manifest.atlas.width || y + height > manifest.atlas.height) {
      throw new Error(`Texture set "${fallbackName}" frame ${index} exceeds atlas bounds.`)
    }
  }
}
