import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sha256(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

/** Copy a source PNG byte-for-byte into the static gallery asset directory. */
export async function copyReviewAsset(sourcePath, assetDirectory, galleryRoot) {
  const source = path.resolve(sourcePath);
  const sourceStat = await stat(source);
  const sourceHash = await sha256(source);
  const targetDirectory = path.resolve(assetDirectory);
  const targetPath = path.join(targetDirectory, `${sourceHash}.png`);
  await mkdir(targetDirectory, { recursive: true });

  const targetIsValid =
    (await exists(targetPath)) &&
    (await stat(targetPath)).size === sourceStat.size &&
    (await sha256(targetPath)) === sourceHash;
  if (!targetIsValid) await copyFile(source, targetPath);
  if ((await sha256(targetPath)) !== sourceHash) {
    throw new Error(`Gallery asset copy did not preserve the source PNG: ${source}`);
  }

  return {
    sourcePath: source,
    sourceSha256: sourceHash,
    assetPath: targetPath,
    assetUrl: path.relative(path.resolve(galleryRoot), targetPath).split(path.sep).join('/'),
  };
}

export async function readReviewImageMetadata(
  sourcePath,
  assetDirectory,
  galleryRoot,
  logicalWidthCss = null,
) {
  const source = path.resolve(sourcePath);
  if (!(await exists(source))) {
    return {
      path: source,
      sourcePath: source,
      fileName: path.basename(source),
      exists: false,
      logicalWidthCss,
      assetPath: null,
      url: null,
    };
  }

  const fileStat = await stat(source);
  const handle = await open(source, 'r');
  const header = Buffer.alloc(24);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const isPng = header.subarray(0, 8).equals(pngSignature);
  const asset = await copyReviewAsset(source, assetDirectory, galleryRoot);
  const pixelWidth = isPng ? header.readUInt32BE(16) : null;

  return {
    path: source,
    sourcePath: asset.sourcePath,
    fileName: path.basename(source),
    exists: true,
    bytes: fileStat.size,
    sha256: asset.sourceSha256,
    pixelWidth,
    pixelHeight: isPng ? header.readUInt32BE(20) : null,
    logicalWidthCss,
    physicalPixelsPerCssPixel: pixelWidth && logicalWidthCss ? pixelWidth / logicalWidthCss : null,
    assetPath: asset.assetPath,
    url: asset.assetUrl,
  };
}
