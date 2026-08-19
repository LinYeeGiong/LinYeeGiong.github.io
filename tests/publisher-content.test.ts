import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PublishError,
  inspectSource,
  mapSourceFolder,
  resolveSlug,
} from '../scripts/publish/content.mjs';

async function makeWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'orbitale-content-'));
  const vaultRoot = path.join(root, 'LinVault');
  const blogRoot = path.join(root, 'LinYeeGiong.github.io');

  await Promise.all([
    mkdir(path.join(vaultRoot, '10_Notes'), { recursive: true }),
    mkdir(path.join(vaultRoot, '20_Essays'), { recursive: true }),
    mkdir(path.join(vaultRoot, '30_Daily'), { recursive: true }),
    mkdir(path.join(blogRoot, 'src', 'content', 'notes'), { recursive: true }),
    mkdir(path.join(blogRoot, 'src', 'content', 'essays'), { recursive: true }),
    mkdir(path.join(blogRoot, 'src', 'content', 'daily'), { recursive: true }),
  ]);

  return { vaultRoot, blogRoot };
}

function noteFrontmatter(overrides = '') {
  return `---
title: Agent Memory
description: A durable memory note
date: 2026-08-19
tags: [AI, Agent]
lang: zh
published: false
${overrides}---

Body.
`;
}

describe('mapSourceFolder', () => {
  it('maps only explicitly public Vault folders', () => {
    expect(mapSourceFolder('10_Notes/cache.md')).toEqual({ kind: 'notes', relative: 'cache.md' });
    expect(mapSourceFolder('20_Essays/life.md')).toEqual({ kind: 'essays', relative: 'life.md' });
    expect(mapSourceFolder('30_Daily/2026-08-19.md')).toEqual({ kind: 'daily', relative: '2026-08-19.md' });
    expect(mapSourceFolder('00_Inbox/private.md')).toBeNull();
    expect(mapSourceFolder('40_Pages/About.md')).toBeNull();
  });
});

describe('resolveSlug', () => {
  it('normalizes an English filename', () => {
    expect(resolveSlug({ kind: 'notes', slug: '', fileStem: 'Agent Memory' })).toBe('agent-memory');
  });

  it('transliterates a Chinese filename to pinyin', () => {
    expect(resolveSlug({ kind: 'notes', slug: '', fileStem: '智能体记忆' })).toBe('zhi-neng-ti-ji-yi');
  });

  it('uses the ISO date for Daily regardless of filename', () => {
    expect(resolveSlug({ kind: 'daily', slug: 'ignored', fileStem: 'today', date: '2026-08-19' })).toBe('2026-08-19');
  });

  it('rejects a slug outside the permanent URL alphabet', () => {
    expect(() => resolveSlug({ kind: 'notes', slug: 'Agent_Memory!', fileStem: 'unused' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_SLUG' }));
  });
});

describe('inspectSource', () => {
  it('plans a first publication with stable generated metadata', async () => {
    const { vaultRoot, blogRoot } = await makeWorkspace();
    const sourcePath = path.join(vaultRoot, '10_Notes', 'Agent Memory.md');
    await writeFile(sourcePath, noteFrontmatter(), 'utf8');

    const plan = await inspectSource({
      sourcePath,
      vaultRoot,
      blogRoot,
      randomUUID: () => '4b99af42-da18-45a2-aefa-0d669e48658f',
    });

    expect(plan).toMatchObject({
      kind: 'notes',
      slug: 'agent-memory',
      publicationId: '4b99af42-da18-45a2-aefa-0d669e48658f',
      action: 'create',
      publicUrl: 'https://linyeegiong.github.io/notes/agent-memory/',
      destinationPath: path.join(blogRoot, 'src', 'content', 'notes', 'agent-memory.md'),
    });
    expect(plan.metadata).toMatchObject({ title: 'Agent Memory', published: true, slug: 'agent-memory' });
  });

  it('treats an empty template publicationId as unpublished', async () => {
    const { vaultRoot, blogRoot } = await makeWorkspace();
    const sourcePath = path.join(vaultRoot, '10_Notes', 'Agent Memory.md');
    await writeFile(sourcePath, noteFrontmatter('slug: ""\npublicationId: ""\n'), 'utf8');

    const plan = await inspectSource({
      sourcePath,
      vaultRoot,
      blogRoot,
      randomUUID: () => '4b99af42-da18-45a2-aefa-0d669e48658f',
    });

    expect(plan.publicationId).toBe('4b99af42-da18-45a2-aefa-0d669e48658f');
  });

  it.each([
    ['title', 'title:'],
    ['description', 'description:'],
    ['date', 'date:'],
  ])('rejects a missing required %s field', async (_field, line) => {
    const { vaultRoot, blogRoot } = await makeWorkspace();
    const sourcePath = path.join(vaultRoot, '10_Notes', 'broken.md');
    const source = noteFrontmatter().replace(new RegExp(`^${line}.*\\n`, 'm'), '');
    await writeFile(sourcePath, source, 'utf8');

    await expect(inspectSource({ sourcePath, vaultRoot, blogRoot }))
      .rejects.toMatchObject({ code: 'INVALID_FRONTMATTER' });
  });

  it('classifies an article with the same publicationId as an update', async () => {
    const { vaultRoot, blogRoot } = await makeWorkspace();
    const sourcePath = path.join(vaultRoot, '10_Notes', 'Agent Memory.md');
    const identity = '4b99af42-da18-45a2-aefa-0d669e48658f';
    await writeFile(sourcePath, noteFrontmatter(`slug: agent-memory\npublicationId: ${identity}\n`), 'utf8');
    await writeFile(
      path.join(blogRoot, 'src', 'content', 'notes', 'agent-memory.md'),
      noteFrontmatter(`slug: agent-memory\npublicationId: ${identity}\n`),
      'utf8',
    );

    const plan = await inspectSource({ sourcePath, vaultRoot, blogRoot });

    expect(plan.action).toBe('update');
    expect(plan.publicationId).toBe(identity);
  });

  it('blocks a different note from reusing an existing slug', async () => {
    const { vaultRoot, blogRoot } = await makeWorkspace();
    const sourcePath = path.join(vaultRoot, '10_Notes', 'Agent Memory.md');
    await writeFile(
      sourcePath,
      noteFrontmatter('slug: agent-memory\npublicationId: 11111111-1111-4111-8111-111111111111\n'),
      'utf8',
    );
    await writeFile(
      path.join(blogRoot, 'src', 'content', 'notes', 'agent-memory.md'),
      noteFrontmatter('slug: agent-memory\npublicationId: 22222222-2222-4222-8222-222222222222\n'),
      'utf8',
    );

    await expect(inspectSource({ sourcePath, vaultRoot, blogRoot }))
      .rejects.toMatchObject({ code: 'SLUG_CONFLICT' });
  });

  it('blocks changing the permanent slug of an existing publication', async () => {
    const { vaultRoot, blogRoot } = await makeWorkspace();
    const sourcePath = path.join(vaultRoot, '10_Notes', 'Renamed.md');
    const identity = '4b99af42-da18-45a2-aefa-0d669e48658f';
    await writeFile(sourcePath, noteFrontmatter(`slug: renamed\npublicationId: ${identity}\n`), 'utf8');
    await writeFile(
      path.join(blogRoot, 'src', 'content', 'notes', 'agent-memory.md'),
      noteFrontmatter(`slug: agent-memory\npublicationId: ${identity}\n`),
      'utf8',
    );

    await expect(inspectSource({ sourcePath, vaultRoot, blogRoot }))
      .rejects.toMatchObject({ code: 'PERMALINK_CHANGE' });
  });

  it('throws a typed error for an unsupported folder', async () => {
    const { vaultRoot, blogRoot } = await makeWorkspace();
    const sourcePath = path.join(vaultRoot, '00_Inbox', 'private.md');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, noteFrontmatter(), 'utf8');

    await expect(inspectSource({ sourcePath, vaultRoot, blogRoot }))
      .rejects.toBeInstanceOf(PublishError);
    await expect(inspectSource({ sourcePath, vaultRoot, blogRoot }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FOLDER' });
  });
});
