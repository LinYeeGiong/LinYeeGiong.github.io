import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { transformArticleImages } from '../scripts/publish/images.mjs';

async function makeImageWorkspace() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'orbitale-images-'));
  const sourcePath = path.join(vaultRoot, '10_Notes', 'agent-memory.md');
  const outputDir = path.join(vaultRoot, '.output');
  await Promise.all([
    mkdir(path.dirname(sourcePath), { recursive: true }),
    mkdir(path.join(vaultRoot, 'Attachments'), { recursive: true }),
  ]);
  await writeFile(sourcePath, '# Agent Memory\n', 'utf8');
  return { vaultRoot, sourcePath, outputDir };
}

describe('transformArticleImages', () => {
  it('copies a Markdown image and rewrites only the public body', async () => {
    const workspace = await makeImageWorkspace();
    const imagePath = path.join(workspace.vaultRoot, 'Attachments', 'diagram.png');
    await writeFile(imagePath, Buffer.from('diagram-bytes'));

    const result = await transformArticleImages({
      body: 'Before\n\n![diagram](../Attachments/diagram.png)\n',
      metadata: {},
      ...workspace,
      kind: 'notes',
      slug: 'agent-memory',
    });

    expect(result.body).toContain('![diagram](/images/notes/agent-memory/diagram.png)');
    expect(result.files).toEqual([{
      sourcePath: imagePath,
      outputName: 'diagram.png',
      publicUrl: '/images/notes/agent-memory/diagram.png',
    }]);
    expect(await readFile(path.join(workspace.outputDir, 'diagram.png'), 'utf8')).toBe('diagram-bytes');
  });

  it('copies cover and Daily image metadata while preserving external URLs', async () => {
    const workspace = await makeImageWorkspace();
    await writeFile(path.join(workspace.vaultRoot, 'Attachments', 'cover.jpg'), Buffer.from('cover'));
    await writeFile(path.join(workspace.vaultRoot, 'Attachments', 'moment.jpg'), Buffer.from('moment'));

    const result = await transformArticleImages({
      body: '![remote](https://example.com/remote.png)\n',
      metadata: {
        cover: '../Attachments/cover.jpg',
        images: ['../Attachments/moment.jpg', 'https://example.com/shared.jpg'],
      },
      ...workspace,
      kind: 'daily',
      slug: '2026-08-19',
    });

    expect(result.body).toContain('https://example.com/remote.png');
    expect(result.metadata).toMatchObject({
      cover: '/images/daily/2026-08-19/cover.jpg',
      images: ['/images/daily/2026-08-19/moment.jpg', 'https://example.com/shared.jpg'],
    });
    expect(result.files).toHaveLength(2);
  });

  it('adds a content hash when different files share a basename', async () => {
    const workspace = await makeImageWorkspace();
    await mkdir(path.join(workspace.vaultRoot, '10_Notes', 'figures'), { recursive: true });
    await writeFile(path.join(workspace.vaultRoot, 'Attachments', 'plot.png'), Buffer.from('first'));
    await writeFile(path.join(workspace.vaultRoot, '10_Notes', 'figures', 'plot.png'), Buffer.from('second'));

    const result = await transformArticleImages({
      body: '![one](../Attachments/plot.png)\n\n![two](figures/plot.png)\n',
      metadata: {},
      ...workspace,
      kind: 'notes',
      slug: 'plots',
    });

    expect(result.files.map((file) => file.outputName)).toEqual([
      'plot.png',
      expect.stringMatching(/^plot-[0-9a-f]{8}\.png$/),
    ]);
  });

  it('rejects a missing local image with its source reference', async () => {
    const workspace = await makeImageWorkspace();

    await expect(transformArticleImages({
      body: '![missing](../Attachments/missing.png)\n',
      metadata: {},
      ...workspace,
      kind: 'notes',
      slug: 'missing',
    })).rejects.toMatchObject({
      code: 'IMAGE_NOT_FOUND',
      details: { reference: '../Attachments/missing.png' },
    });
  });

  it('rejects an image that resolves outside the Vault', async () => {
    const workspace = await makeImageWorkspace();
    const outside = path.join(path.dirname(workspace.vaultRoot), 'outside.png');
    await writeFile(outside, Buffer.from('private'));

    await expect(transformArticleImages({
      body: '![outside](../../outside.png)\n',
      metadata: {},
      ...workspace,
      kind: 'notes',
      slug: 'outside',
    })).rejects.toMatchObject({ code: 'IMAGE_OUTSIDE_VAULT' });
  });

  it('rejects legacy Obsidian wiki image embeds with migration guidance', async () => {
    const workspace = await makeImageWorkspace();

    await expect(transformArticleImages({
      body: '![[diagram.png]]\n',
      metadata: {},
      ...workspace,
      kind: 'notes',
      slug: 'wiki-image',
    })).rejects.toMatchObject({ code: 'WIKI_IMAGE_UNSUPPORTED' });
  });
});
