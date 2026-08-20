import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import { inspectSource, PublishError } from './content.mjs';
import { ensureRepository, runGit, runNpm } from './git.mjs';
import { transformArticleImages } from './images.mjs';

async function readOptional(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error.code === 'EISDIR') return true;
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function inspectPublication(options) {
  return inspectSource(options);
}

async function defaultVerify(blogRoot) {
  try {
    await runNpm(['run', 'verify'], { cwd: blogRoot });
  } catch (error) {
    throw new PublishError('VERIFY_FAILED', 'Astro 验证失败，文章没有提交。', error.details ?? {});
  }
}

/**
 * @param {{
 *   sourcePath: string,
 *   vaultRoot: string,
 *   blogRoot: string,
 *   expectedRemote?: string,
 *   confirmUpdate?: boolean,
 *   randomUUID?: () => string,
 *   siteUrl?: string,
 *   gitRunner?: (args: string[], options?: Record<string, any>) => Promise<any>,
 *   verifyRunner?: (blogRoot: string) => Promise<void>
 * }} options
 */
export async function executePublication(options) {
  const {
    sourcePath,
    vaultRoot,
    blogRoot,
    expectedRemote,
    confirmUpdate = false,
    randomUUID,
    siteUrl,
    gitRunner = runGit,
    verifyRunner = defaultVerify,
  } = options;
  const initialPlan = await inspectSource({ sourcePath, vaultRoot, blogRoot, randomUUID, siteUrl });
  if (initialPlan.action === 'update' && !confirmUpdate) {
    throw new PublishError('UPDATE_CONFIRMATION_REQUIRED', '更新已有文章前需要确认。', {
      slug: initialPlan.slug,
    });
  }

  await ensureRepository({ blogRoot, expectedRemote, gitRunner });
  await gitRunner(['pull', '--rebase', 'origin', 'main'], { cwd: blogRoot });

  const plan = await inspectSource({
    sourcePath,
    vaultRoot,
    blogRoot,
    randomUUID: () => initialPlan.publicationId,
    siteUrl,
  });
  if (plan.action === 'update' && !confirmUpdate) {
    throw new PublishError('UPDATE_CONFIRMATION_REQUIRED', '更新已有文章前需要确认。', { slug: plan.slug });
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'orbitale-publish-'));
  const stagedImages = path.join(temporaryRoot, 'images');
  const backupImages = path.join(temporaryRoot, 'backup-images');
  const imageDirectory = path.join(blogRoot, 'public', 'images', plan.kind, plan.slug);
  const sourceBefore = Buffer.from(plan.sourceText, 'utf8');
  const destinationBefore = await readOptional(plan.destinationPath);
  const imagesExisted = await pathExists(imageDirectory);
  if (imagesExisted) await cp(imageDirectory, backupImages, { recursive: true });

  let committed = false;
  try {
    const transformed = await transformArticleImages({
      body: plan.body,
      metadata: plan.metadata,
      sourcePath,
      vaultRoot,
      kind: plan.kind,
      slug: plan.slug,
      outputDir: stagedImages,
    });
    const sourceDocument = matter.stringify(plan.body, plan.metadata);
    const publicDocument = matter.stringify(transformed.body, transformed.metadata);

    await mkdir(path.dirname(plan.destinationPath), { recursive: true });
    await writeFile(sourcePath, sourceDocument, 'utf8');
    await writeFile(plan.destinationPath, publicDocument, 'utf8');
    await rm(imageDirectory, { recursive: true, force: true });
    if (transformed.files.length > 0) {
      await mkdir(path.dirname(imageDirectory), { recursive: true });
      await cp(stagedImages, imageDirectory, { recursive: true });
    }

    await verifyRunner(blogRoot);

    const articleRelative = path.relative(blogRoot, plan.destinationPath);
    const imagesRelative = path.relative(blogRoot, imageDirectory);
    const pathsToStage = [articleRelative];
    if (imagesExisted || transformed.files.length > 0) pathsToStage.push(imagesRelative);
    await gitRunner(['add', '-A', '--', ...pathsToStage], { cwd: blogRoot });
    const staged = (await gitRunner(['diff', '--cached', '--name-only'], { cwd: blogRoot })).stdout.trim();
    if (!staged) {
      return { ok: true, phase: 'publish', action: 'noop', slug: plan.slug, kind: plan.kind, publicUrl: plan.publicUrl };
    }

    await gitRunner(['commit', '-m', `content: publish ${plan.slug}`], { cwd: blogRoot });
    committed = true;
    try {
      await gitRunner(['push', 'origin', 'main'], { cwd: blogRoot });
    } catch (error) {
      throw new PublishError('PUSH_PENDING', '文章已在本地提交，但推送失败；下次发布会继续尝试。', {
        cause: error.message,
      });
    }

    return {
      ok: true,
      phase: 'publish',
      action: plan.action,
      slug: plan.slug,
      kind: plan.kind,
      publicUrl: plan.publicUrl,
    };
  } catch (error) {
    if (!committed) {
      await writeFile(sourcePath, sourceBefore);
      if (destinationBefore === null) await rm(plan.destinationPath, { force: true });
      else await writeFile(plan.destinationPath, destinationBefore);
      await rm(imageDirectory, { recursive: true, force: true });
      if (imagesExisted) {
        await mkdir(path.dirname(imageDirectory), { recursive: true });
        await cp(backupImages, imageDirectory, { recursive: true });
      }
      await gitRunner([
        'restore', '--staged', '--',
        path.relative(blogRoot, plan.destinationPath),
        path.relative(blogRoot, imageDirectory),
      ], { cwd: blogRoot, allowFailure: true });
    }
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
