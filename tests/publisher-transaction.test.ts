import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import { PublishError } from '../scripts/publish/content.mjs';
import { runGit } from '../scripts/publish/git.mjs';
import { executePublication, inspectPublication } from '../scripts/publish/transaction.mjs';

const execFile = promisify(execFileCallback);
const publisherCli = path.resolve('scripts/publish-note.mjs');

async function git(cwd: string, args: string[]) {
  const result = await execFile('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

function sourceDocument(overrides = '') {
  return `---
title: Agent Memory
description: A durable memory note
date: 2026-08-19
tags: [AI]
lang: zh
published: false
${overrides}---

![diagram](../Attachments/diagram.png)
`;
}

async function makeRepository({ verifyExit = 0 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'orbitale-transaction-'));
  const vaultRoot = path.join(root, 'LinVault');
  const blogRoot = path.join(root, 'LinYeeGiong.github.io');
  const remoteRoot = path.join(root, 'remote.git');
  const sourcePath = path.join(vaultRoot, '10_Notes', 'Agent Memory.md');

  await Promise.all([
    mkdir(path.dirname(sourcePath), { recursive: true }),
    mkdir(path.join(vaultRoot, 'Attachments'), { recursive: true }),
    mkdir(path.join(blogRoot, 'src', 'content', 'notes'), { recursive: true }),
    mkdir(path.join(blogRoot, 'src', 'content', 'essays'), { recursive: true }),
    mkdir(path.join(blogRoot, 'src', 'content', 'daily'), { recursive: true }),
    mkdir(path.join(blogRoot, 'public', 'images'), { recursive: true }),
  ]);
  await writeFile(sourcePath, sourceDocument(), 'utf8');
  await writeFile(path.join(vaultRoot, 'Attachments', 'diagram.png'), Buffer.from('diagram'));
  await writeFile(
    path.join(blogRoot, 'package.json'),
    JSON.stringify({
      type: 'module',
      scripts: { verify: `node -e "process.exit(${verifyExit})"` },
    }, null, 2),
    'utf8',
  );
  await writeFile(path.join(blogRoot, 'src', 'content', 'notes', '.gitkeep'), '', 'utf8');

  await git(root, ['init', '--bare', remoteRoot]);
  await git(blogRoot, ['init', '-b', 'main']);
  await git(blogRoot, ['config', 'user.name', 'LinYeeGiong']);
  await git(blogRoot, ['config', 'user.email', 'linyifeng@stu.xmu.edu.cn']);
  await git(blogRoot, ['add', '.']);
  await git(blogRoot, ['commit', '-m', 'initial']);
  await git(blogRoot, ['remote', 'add', 'origin', remoteRoot]);
  await git(blogRoot, ['push', '-u', 'origin', 'main']);

  return { root, vaultRoot, blogRoot, remoteRoot, sourcePath };
}

describe('publication transaction', () => {
  it('inspects without changing the source or repository', async () => {
    const workspace = await makeRepository();
    const before = await readFile(workspace.sourcePath, 'utf8');

    const plan = await inspectPublication({
      ...workspace,
      randomUUID: () => '4b99af42-da18-45a2-aefa-0d669e48658f',
    });

    expect(plan).toMatchObject({ action: 'create', kind: 'notes', slug: 'agent-memory' });
    expect(await readFile(workspace.sourcePath, 'utf8')).toBe(before);
    expect(await git(workspace.blogRoot, ['status', '--porcelain'])).toBe('');
  });

  it('publishes article metadata and images through a real local Git remote', async () => {
    const workspace = await makeRepository();

    const result = await executePublication({
      ...workspace,
      expectedRemote: workspace.remoteRoot,
      randomUUID: () => '4b99af42-da18-45a2-aefa-0d669e48658f',
    });

    const publicPath = path.join(workspace.blogRoot, 'src', 'content', 'notes', 'agent-memory.md');
    const published = matter(await readFile(publicPath, 'utf8'));
    const source = matter(await readFile(workspace.sourcePath, 'utf8'));
    expect(result).toMatchObject({ ok: true, action: 'create', slug: 'agent-memory' });
    expect(published.data).toMatchObject({
      published: true,
      slug: 'agent-memory',
      publicationId: '4b99af42-da18-45a2-aefa-0d669e48658f',
    });
    expect(source.data).toMatchObject({ published: true, slug: 'agent-memory' });
    expect(published.content).toContain('/images/notes/agent-memory/diagram.png');
    expect(await readFile(
      path.join(workspace.blogRoot, 'public', 'images', 'notes', 'agent-memory', 'diagram.png'),
      'utf8',
    )).toBe('diagram');
    expect(await git(workspace.blogRoot, ['log', '-1', '--format=%s'])).toBe('content: publish agent-memory');
    expect(await git(workspace.blogRoot, ['rev-parse', 'HEAD']))
      .toBe(await git(workspace.remoteRoot, ['rev-parse', 'main']));
  });

  it('requires explicit confirmation before updating an existing article', async () => {
    const workspace = await makeRepository();
    await executePublication({
      ...workspace,
      expectedRemote: workspace.remoteRoot,
      randomUUID: () => '4b99af42-da18-45a2-aefa-0d669e48658f',
    });
    await writeFile(
      workspace.sourcePath,
      sourceDocument('slug: agent-memory\npublicationId: 4b99af42-da18-45a2-aefa-0d669e48658f\n'),
      'utf8',
    );

    await expect(executePublication({ ...workspace, expectedRemote: workspace.remoteRoot }))
      .rejects.toMatchObject({ code: 'UPDATE_CONFIRMATION_REQUIRED' });
  });

  it('refuses to publish over unrelated dirty repository changes', async () => {
    const workspace = await makeRepository();
    await writeFile(path.join(workspace.blogRoot, 'README.md'), 'uncommitted', 'utf8');

    await expect(executePublication({ ...workspace, expectedRemote: workspace.remoteRoot }))
      .rejects.toMatchObject({ code: 'GIT_DIRTY' });
  });

  it('restores source and public files when verification fails before commit', async () => {
    const workspace = await makeRepository({ verifyExit: 7 });
    const sourceBefore = await readFile(workspace.sourcePath, 'utf8');
    const headBefore = await git(workspace.blogRoot, ['rev-parse', 'HEAD']);

    await expect(executePublication({
      ...workspace,
      expectedRemote: workspace.remoteRoot,
      randomUUID: () => '4b99af42-da18-45a2-aefa-0d669e48658f',
    })).rejects.toMatchObject({ code: 'VERIFY_FAILED' });

    expect(await readFile(workspace.sourcePath, 'utf8')).toBe(sourceBefore);
    expect(await git(workspace.blogRoot, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(await git(workspace.blogRoot, ['status', '--porcelain'])).toBe('');
    await expect(readFile(
      path.join(workspace.blogRoot, 'src', 'content', 'notes', 'agent-memory.md'),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a verified local commit when the remote push fails', async () => {
    const workspace = await makeRepository();
    const remoteBefore = await git(workspace.remoteRoot, ['rev-parse', 'main']);
    const pushFailingGit = async (args: string[], options: Record<string, unknown> = {}) => {
      if (args[0] === 'push') throw new PublishError('GIT_PUSH_FAILED', 'push rejected');
      return runGit(args, options);
    };

    await expect(executePublication({
      ...workspace,
      expectedRemote: workspace.remoteRoot,
      randomUUID: () => '4b99af42-da18-45a2-aefa-0d669e48658f',
      gitRunner: pushFailingGit,
    })).rejects.toMatchObject({ code: 'PUSH_PENDING' });

    expect(await git(workspace.blogRoot, ['log', '-1', '--format=%s'])).toBe('content: publish agent-memory');
    expect(await git(workspace.remoteRoot, ['rev-parse', 'main'])).toBe(remoteBefore);
    expect(await git(workspace.blogRoot, ['status', '--porcelain'])).toBe('');
  });

  it('prints a machine-readable inspection result from the CLI', async () => {
    const workspace = await makeRepository();
    const result = await execFile(process.execPath, [
      publisherCli,
      'inspect',
      '--vault', workspace.vaultRoot,
      '--note', path.relative(workspace.vaultRoot, workspace.sourcePath),
      '--blog', workspace.blogRoot,
      '--json',
    ], { encoding: 'utf8' });

    const output = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? '{}');
    expect(output).toMatchObject({ ok: true, phase: 'inspect', action: 'create', slug: 'agent-memory' });
  });
});
