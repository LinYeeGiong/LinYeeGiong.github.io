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

  it('renders all approved research areas as structured focus items', () => {
    expect(html.match(/data-focus-item/g)).toHaveLength(3);
    expect(html).toContain('AGENT SYSTEMS');
    expect(html).toContain('MLLMS');
    expect(html).toContain('COMPUTER VISION');
  });

  it('publishes public links without exposing an empty email link', () => {
    expect(html).toContain('href="https://github.com/LinYeeGiong"');
    expect(html).toContain('href="/rss.xml"');
    expect(html).not.toContain('href="mailto:');
  });
});
