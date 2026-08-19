import { describe, expect, it } from 'vitest';

import { siteConfig } from '../src/config/site';

describe('siteConfig', () => {
  it('contains the complete public customization contract', () => {
    expect(new URL(siteConfig.siteUrl).protocol).toBe('https:');
    expect(siteConfig.navigation.map((item) => item.href)).toContain('/notes/');
    expect(siteConfig.terminal.shortcuts).toContain('/explore');
    expect(siteConfig.exploration.every((field) => field.tags.length > 0)).toBe(true);
    expect(siteConfig.footer.links.some((link) => link.href === '/rss.xml')).toBe(true);
  });

  it('keeps personal identity in the configuration', () => {
    expect(siteConfig.name).toBe('Lin');
    expect(siteConfig.brand).toBe('LIN / LAB NOTES');
    expect(siteConfig.terminal.user).toBe('lin');
    expect(siteConfig.location).toContain('SHANGHAI');
  });

  it('centralizes the complete public About profile', () => {
    expect(siteConfig.about.title).toBe('LinYeeGiong');
    expect(siteConfig.about.identity).toBe('厦门大学研究生在读');
    expect(siteConfig.about.avatar).toBe('/images/profile/lin-avatar.jpg');
    expect(siteConfig.about.focuses.map((focus) => focus.label)).toEqual([
      'AGENT SYSTEMS',
      'MLLMS',
      'COMPUTER VISION',
    ]);
    expect(siteConfig.about.stack.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([
        'Python',
        'TypeScript',
        'FastAPI',
        'Pydantic',
        'PostgreSQL',
        'Next.js',
        'Astro',
        'Docker',
        'GitHub Actions',
        'Obsidian',
      ]),
    );
    expect(siteConfig.about.sections).toEqual({
      focus: {
        eyebrow: '02 / CURRENT FOCUS',
        title: '正在探索的方向',
        description: '研究不只是一个主题列表，而是一组持续变化、彼此连接的问题。',
      },
      stack: {
        eyebrow: '03 / WORKING STACK',
        title: '常用技术栈',
        description: '技术栈会随问题变化。重要的是选择合适的工具，把想法做成可靠、可复现的系统。',
      },
      principles: { eyebrow: '04 / PRINCIPLES', title: '我的工作方式' },
      timeline: { eyebrow: '05 / TIMELINE', title: '当前阶段' },
      beyond: { eyebrow: '06 / BEYOND CODE', title: '技术之外' },
    });
    expect(siteConfig.email).toBeNull();
  });
});
