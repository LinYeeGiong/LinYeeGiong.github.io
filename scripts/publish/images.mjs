import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { PublishError } from './content.mjs';

function isPublicReference(reference) {
  return /^(?:https?:|data:|\/)/i.test(reference);
}

function normalizedOutputName(reference) {
  const extension = path.extname(reference).toLowerCase();
  const stem = path.basename(reference, path.extname(reference))
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';
  const safeExtension = /^\.[a-z0-9]+$/.test(extension) ? extension : '';
  return `${stem}${safeExtension}`;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function transformArticleImages({
  body,
  metadata,
  sourcePath,
  vaultRoot,
  kind,
  slug,
  outputDir,
}) {
  if (/!\[\[[^\]]+\]\]/u.test(body)) {
    throw new PublishError(
      'WIKI_IMAGE_UNSUPPORTED',
      '检测到 Obsidian Wiki 图片嵌入，请改为标准 Markdown 图片链接后再发布。',
    );
  }

  const canonicalVault = await realpath(vaultRoot);
  const sourceDirectory = path.dirname(sourcePath);
  const outputByName = new Map();
  const outputBySource = new Map();
  const files = [];
  await mkdir(outputDir, { recursive: true });

  async function register(reference) {
    if (typeof reference !== 'string' || !reference || isPublicReference(reference)) return reference;

    let decoded;
    try {
      decoded = decodeURI(reference);
    } catch {
      decoded = reference;
    }
    const resolved = path.resolve(sourceDirectory, decoded);
    if (!isInside(vaultRoot, resolved)) {
      throw new PublishError('IMAGE_OUTSIDE_VAULT', `图片路径超出 Vault：${reference}`, { reference });
    }

    let canonicalSource;
    try {
      canonicalSource = await realpath(resolved);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new PublishError('IMAGE_NOT_FOUND', `找不到图片：${reference}`, { reference });
      }
      throw error;
    }
    if (!isInside(canonicalVault, canonicalSource)) {
      throw new PublishError('IMAGE_OUTSIDE_VAULT', `图片路径超出 Vault：${reference}`, { reference });
    }

    const existing = outputBySource.get(canonicalSource);
    if (existing) return existing.publicUrl;

    let outputName = normalizedOutputName(decoded);
    const conflictingSource = outputByName.get(outputName);
    if (conflictingSource && conflictingSource !== canonicalSource) {
      const bytes = await readFile(canonicalSource);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
      const extension = path.extname(outputName);
      outputName = `${path.basename(outputName, extension)}-${hash}${extension}`;
    }

    const publicUrl = `/images/${kind}/${slug}/${outputName}`;
    const record = { sourcePath: resolved, outputName, publicUrl };
    await copyFile(canonicalSource, path.join(outputDir, outputName));
    outputByName.set(outputName, canonicalSource);
    outputBySource.set(canonicalSource, record);
    files.push(record);
    return publicUrl;
  }

  const processor = unified().use(remarkParse).use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
  });
  const tree = processor.parse(body);
  const imageNodes = [];
  visit(tree, 'image', (node) => imageNodes.push(node));
  for (const node of imageNodes) node.url = await register(node.url);

  const transformedMetadata = { ...metadata };
  if (typeof transformedMetadata.cover === 'string') {
    transformedMetadata.cover = await register(transformedMetadata.cover);
  }
  if (Array.isArray(transformedMetadata.images)) {
    transformedMetadata.images = await Promise.all(
      transformedMetadata.images.map((reference) => register(reference)),
    );
  }

  return {
    body: processor.stringify(tree),
    metadata: transformedMetadata,
    files,
  };
}
