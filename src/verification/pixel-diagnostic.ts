import sharp from 'sharp';

/** Pixel disagreement is diagnostic evidence, never an automatic fidelity pass. */
export async function createPixelDiagnostic(sourcePath: string, targetPath: string, outputPath: string): Promise<{
  heatmapPath: string; comparedWidth: number; comparedHeight: number; sourceHeight: number; targetHeight: number; meanAbsoluteChannelDifference: number;
}> {
  const sourceMetadata = await sharp(sourcePath).metadata(), targetMetadata = await sharp(targetPath).metadata();
  const width = Math.min(sourceMetadata.width ?? 0, targetMetadata.width ?? 0);
  const height = Math.min(sourceMetadata.height ?? 0, targetMetadata.height ?? 0);
  if (!width || !height) throw new Error('Screenshots have no comparable pixel dimensions.');
  const source = await sharp(sourcePath).extract({ left: 0, top: 0, width, height }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const target = await sharp(targetPath).extract({ left: 0, top: 0, width, height }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const output = Buffer.alloc(width * height * 3);
  let total = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 3;
    const difference = (Math.abs(source[offset] - target[offset]) + Math.abs(source[offset + 1] - target[offset + 1]) + Math.abs(source[offset + 2] - target[offset + 2])) / 3;
    total += difference;
    output[offset] = Math.min(255, Math.round(difference * 3));
    output[offset + 1] = Math.round(difference * 0.35);
    output[offset + 2] = Math.round(difference * 0.1);
  }
  await sharp(output, { raw: { width, height, channels: 3 } }).png().toFile(outputPath);
  return { heatmapPath: outputPath, comparedWidth: width, comparedHeight: height, sourceHeight: sourceMetadata.height!, targetHeight: targetMetadata.height!, meanAbsoluteChannelDifference: total / (width * height) };
}
