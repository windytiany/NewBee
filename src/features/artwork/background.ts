export const ALBUM_BACKGROUND_SAMPLE_SIZE = 32;

export type AlbumBackground = {
  imageUrl: string;
  color: string;
};

const BLUR_RADIUS = 3;
const BLUR_PASSES = 3;
const SATURATION = 0.85;
const BRIGHTNESS = 0.4;

/** Removes artwork detail while retaining its large-scale color distribution. */
export function createAlbumBackgroundPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
): { pixels: Uint8ClampedArray; color: string } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    source.length !== width * height * 4
  )
    throw new RangeError("Invalid artwork pixel dimensions");

  let pixels = new Float64Array(source.length);
  for (let index = 0; index < source.length; index += 4) {
    const opacity = readChannel(source, index + 3) / 255;
    for (let channel = 0; channel < 3; channel++) {
      pixels[index + channel] = readChannel(source, index + channel) * opacity;
    }
    pixels[index + 3] = 255;
  }

  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    pixels = blur(blur(pixels, width, height, "horizontal"), width, height, "vertical");
  }

  const result = new Uint8ClampedArray(source.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance =
      readChannel(pixels, index) * 0.2126 +
      readChannel(pixels, index + 1) * 0.7152 +
      readChannel(pixels, index + 2) * 0.0722;
    for (let channel = 0; channel < 3; channel++) {
      result[index + channel] =
        (luminance + (readChannel(pixels, index + channel) - luminance) * SATURATION) * BRIGHTNESS;
    }
    result[index + 3] = 255;
  }

  // The panel's top gradient and pointer share this exact color.
  const topColor = [0, 0, 0];
  for (let x = 0; x < width; x++) {
    for (let channel = 0; channel < 3; channel++) {
      topColor[channel] =
        readChannel(topColor, channel) + readChannel(result, x * 4 + channel) / width;
    }
  }
  return {
    pixels: result,
    color: `rgb(${topColor.map(Math.round).join(", ")})`,
  };
}

function readChannel(source: ArrayLike<number>, index: number): number {
  const value = source[index];
  if (value === undefined) throw new RangeError("Artwork pixel index out of bounds");
  return value;
}

function blur(
  source: Float64Array,
  width: number,
  height: number,
  axis: "horizontal" | "vertical",
) {
  const result = new Float64Array(source.length);
  const kernelSize = BLUR_RADIUS * 2 + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      for (let offset = -BLUR_RADIUS; offset <= BLUR_RADIUS; offset++) {
        const sampleX = axis === "horizontal" ? Math.max(0, Math.min(width - 1, x + offset)) : x;
        const sampleY = axis === "vertical" ? Math.max(0, Math.min(height - 1, y + offset)) : y;
        const sampleIndex = (sampleY * width + sampleX) * 4;
        for (let channel = 0; channel < 3; channel++) {
          result[index + channel] =
            readChannel(result, index + channel) +
            readChannel(source, sampleIndex + channel) / kernelSize;
        }
      }
      result[index + 3] = 255;
    }
  }
  return result;
}
