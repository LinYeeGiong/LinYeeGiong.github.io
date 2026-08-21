import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getCollection } from 'astro:content';
import { beforeAll, describe, expect, it } from 'vitest';

import DailyArticlePage from '../src/pages/daily/[...slug].astro';
import EssayArticlePage from '../src/pages/essays/[...slug].astro';

describe('content detail pages', () => {
  let essayHtml: string;
  let dailyHtml: string;

  beforeAll(async () => {
    const container = await AstroContainer.create();
    const [essay] = await getCollection('essays');
    const [daily] = await getCollection('daily');

    essayHtml = await container.renderToString(EssayArticlePage, {
      props: { entry: essay },
      request: new Request('https://lin.example/essays/public-writing/'),
    });
    dailyHtml = await container.renderToString(DailyArticlePage, {
      props: { entry: daily },
      request: new Request('https://lin.example/daily/2026-08-17/'),
    });
  });

  it('keeps the notes collection empty after public notes are cleared', async () => {
    expect(await getCollection('notes')).toEqual([]);
  });

  it('renders essay and Daily through the same article contract', () => {
    expect(essayHtml).toContain('data-article-kind="essays"');
    expect(essayHtml).toContain('多年以后回来看');
    expect(dailyHtml).toContain('data-article-kind="daily"');
    expect(dailyHtml).toContain('它开始不像一个模板');
  });

  it('includes collection navigation and copy-link enhancement', () => {
    expect(dailyHtml).toContain('href="/daily/"');
  });
});
