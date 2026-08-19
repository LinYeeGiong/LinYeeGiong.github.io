import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import AboutPage from '../src/pages/about.astro';

describe('personal About page', () => {
  let html: string;

  beforeAll(async () => {
    const container = await AstroContainer.create();
    html = await container.renderToString(AboutPage, {
      partial: false,
      request: new Request('https://linyeegiong.github.io/about/'),
    });
  });

  it('renders the public identity and supplied profile image accessibly', () => {
    expect(html).toContain('data-about-profile');
    expect(html).toContain('LinYeeGiong');
    expect(html).toContain('厦门大学研究生在读');
    expect(html).toContain('src="/images/profile/lin-avatar.jpg"');
    expect(html).toContain('alt="LinYeeGiong 的头像"');
  });

  it('uses the profile image for browser and Apple device icons', () => {
    expect(html).toContain('rel="icon" type="image/jpeg" href="/images/profile/lin-avatar.jpg?v=1"');
    expect(html).toContain('rel="apple-touch-icon" href="/images/profile/lin-avatar.jpg?v=1"');
  });

  it('renders all approved research areas as structured focus items', () => {
    expect(html.match(/data-focus-item/g)).toHaveLength(3);
    expect(html).toContain('AGENT SYSTEMS');
    expect(html).toContain('MLLMS');
    expect(html).toContain('COMPUTER VISION');
  });

  it('renders the configured About sections and complete working stack', () => {
    expect(html).toContain('正在探索的方向');
    expect(html).toContain('常用技术栈');
    expect(html).toContain('我的工作方式');
    expect(html).toContain('当前阶段');
    expect(html).toContain('技术之外');
    expect(html).toContain('Astro');
    expect(html).toContain('GitHub Actions');
    expect(html).toContain('Obsidian');
  });

  it('publishes public links without exposing an empty email link', () => {
    const contact = html.match(/<div class="contact-band" data-about-contact[^>]*>([\s\S]*?)<\/div>/)?.[1];

    expect(contact).toBeDefined();
    expect(contact).toContain('href="https://github.com/LinYeeGiong"');
    expect(contact).toContain('href="/rss.xml"');
    expect(contact).not.toContain('href="mailto:');
  });

  it('does not claim a live online state or focus static research cards', () => {
    expect(html).not.toContain('ONLINE');
    expect(html).not.toContain('data-focus-item tabindex="0"');
  });
});
