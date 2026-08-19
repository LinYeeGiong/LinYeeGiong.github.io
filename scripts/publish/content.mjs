import { randomUUID as createUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import matter from 'gray-matter';
import { pinyin } from 'pinyin-pro';

const COLLECTIONS = {
  '10_Notes': 'notes',
  '20_Essays': 'essays',
  '30_Daily': 'daily',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PublishError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.details = details;
  }
}

export function mapSourceFolder(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const [folder, ...rest] = normalized.split('/');
  const kind = COLLECTIONS[folder];
  if (!kind || rest.length === 0) return null;
  return { kind, relative: rest.join('/') };
}

function slugify(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  throw new PublishError('INVALID_FRONTMATTER', 'date 必须是有效的 YYYY-MM-DD 日期。', { field: 'date' });
}

/**
 * @param {{ kind: string, slug?: string, fileStem?: string, date?: string | Date }} options
 */
export function resolveSlug({ kind, slug = '', fileStem = '', date }) {
  if (kind === 'daily') {
    return normalizeDate(date);
  }

  if (slug) {
    if (typeof slug !== 'string' || !VALID_SLUG.test(slug)) {
      throw new PublishError('INVALID_SLUG', 'slug 只能包含小写字母、数字和单个连字符。', { slug });
    }
    return slug;
  }

  const transliterated = /[\u3400-\u9fff]/u.test(fileStem)
    ? pinyin(fileStem, { toneType: 'none', type: 'array' }).join('-')
    : fileStem;
  const resolved = slugify(transliterated);
  if (!resolved) {
    throw new PublishError('INVALID_SLUG', '无法从文件名生成 slug，请在 frontmatter 中填写 slug。');
  }
  return resolved;
}

function validateMetadata(data) {
  for (const field of ['title', 'description']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      throw new PublishError('INVALID_FRONTMATTER', `${field} 不能为空。`, { field });
    }
  }

  const date = normalizeDate(data.date);
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string'))) {
    throw new PublishError('INVALID_FRONTMATTER', 'tags 必须是字符串数组。', { field: 'tags' });
  }
  if (data.lang !== undefined && !['zh', 'en'].includes(data.lang)) {
    throw new PublishError('INVALID_FRONTMATTER', 'lang 必须是 zh 或 en。', { field: 'lang' });
  }
  if (data.publicationId && (typeof data.publicationId !== 'string' || !UUID_PATTERN.test(data.publicationId))) {
    throw new PublishError('INVALID_FRONTMATTER', 'publicationId 必须是有效 UUID。', { field: 'publicationId' });
  }

  return {
    ...data,
    title: data.title.trim(),
    description: data.description.trim(),
    date,
    tags: data.tags ?? [],
    lang: data.lang ?? 'zh',
  };
}

async function listMarkdownFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdownFiles(entryPath));
    else if (/\.(?:md|mdx)$/i.test(entry.name)) files.push(entryPath);
  }
  return files;
}

async function readPublicationId(filePath) {
  try {
    const parsed = matter(await readFile(filePath, 'utf8'));
    return typeof parsed.data.publicationId === 'string' ? parsed.data.publicationId : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function inspectSource({
  sourcePath,
  vaultRoot,
  blogRoot,
  randomUUID = createUUID,
  siteUrl = 'https://linyeegiong.github.io',
}) {
  const relativeSource = path.relative(vaultRoot, sourcePath);
  if (!relativeSource || relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
    throw new PublishError('UNSUPPORTED_FOLDER', '当前文件不在 LinVault 内。');
  }
  const mapping = mapSourceFolder(relativeSource);
  if (!mapping) {
    throw new PublishError('UNSUPPORTED_FOLDER', '请先把文章移动到 10_Notes、20_Essays 或 30_Daily。', {
      relativeSource,
    });
  }

  let sourceText;
  try {
    sourceText = await readFile(sourcePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new PublishError('SOURCE_NOT_FOUND', '找不到当前 Obsidian 文件。');
    throw error;
  }

  let parsed;
  try {
    parsed = matter(sourceText);
  } catch (error) {
    throw new PublishError('INVALID_FRONTMATTER', `frontmatter 无法解析：${error.message}`);
  }
  const validated = validateMetadata(parsed.data);
  const slug = resolveSlug({
    kind: mapping.kind,
    slug: validated.slug ?? '',
    fileStem: path.basename(sourcePath, path.extname(sourcePath)),
    date: validated.date,
  });
  const publicationId = validated.publicationId || randomUUID();
  const metadata = {
    ...validated,
    slug,
    publicationId,
    published: true,
  };
  const destinationPath = path.join(blogRoot, 'src', 'content', mapping.kind, `${slug}.md`);

  let identityPath = null;
  for (const kind of Object.values(COLLECTIONS)) {
    const directory = path.join(blogRoot, 'src', 'content', kind);
    for (const candidate of await listMarkdownFiles(directory)) {
      if (await readPublicationId(candidate) === publicationId) {
        identityPath = candidate;
        break;
      }
    }
    if (identityPath) break;
  }

  if (identityPath && path.resolve(identityPath) !== path.resolve(destinationPath)) {
    throw new PublishError('PERMALINK_CHANGE', '已发布文章的 slug 不能直接修改。', {
      existingPath: identityPath,
      requestedPath: destinationPath,
    });
  }

  const targetIdentity = await readPublicationId(destinationPath);
  if (targetIdentity && targetIdentity !== publicationId) {
    throw new PublishError('SLUG_CONFLICT', `slug "${slug}" 已被另一篇文章使用。`, { destinationPath });
  }
  if (!targetIdentity) {
    try {
      await readFile(destinationPath, 'utf8');
      throw new PublishError('SLUG_CONFLICT', `slug "${slug}" 已对应一篇旧文章，无法自动覆盖。`, {
        destinationPath,
      });
    } catch (error) {
      if (error instanceof PublishError) throw error;
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const action = targetIdentity === publicationId ? 'update' : 'create';
  return {
    kind: mapping.kind,
    sourcePath,
    sourceText,
    body: parsed.content,
    destinationPath,
    existingPath: action === 'update' ? destinationPath : null,
    slug,
    publicationId,
    metadata,
    action,
    publicUrl: `${siteUrl.replace(/\/$/, '')}/${mapping.kind}/${slug}/`,
  };
}
