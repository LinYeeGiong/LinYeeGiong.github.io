import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const publishCurrentNote = require('../scripts/obsidian/publish-current-note.cjs');

type SpawnResult = { code: number; stdout: string; stderr: string };
type BridgeParams = {
  app: {
    workspace: { getActiveFile: () => { path: string; extension: string } };
    vault: { adapter: { basePath: string } };
  };
  quickAddApi: { yesNoPrompt: ReturnType<typeof vi.fn> };
  showNotice: (message: string) => void;
  spawnProcess?: (command: string, args: string[], options?: Record<string, unknown>) => Promise<SpawnResult>;
};

function makeObsidian({ confirm = true } = {}) {
  const notices: string[] = [];
  const params: BridgeParams = {
    app: {
      workspace: { getActiveFile: () => ({ path: '10_Notes/Agent Memory.md', extension: 'md' }) },
      vault: { adapter: { basePath: path.join('D:', 'PersonalBlog', 'LinVault') } },
    },
    quickAddApi: { yesNoPrompt: vi.fn().mockResolvedValue(confirm) },
    showNotice: (message: string) => notices.push(message),
  };
  return {
    notices,
    params,
  };
}

describe('QuickAdd publish bridge', () => {
  it('inspects and publishes the active note without a shell command', async () => {
    const obsidian = makeObsidian();
    const calls: Array<{ command: string; args: string[] }> = [];
    obsidian.params.spawnProcess = async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (args.includes('inspect')) {
        return { code: 0, stdout: '{"ok":true,"phase":"inspect","action":"create","slug":"agent-memory"}\n', stderr: '' };
      }
      return {
        code: 0,
        stdout: '{"ok":true,"phase":"publish","action":"create","slug":"agent-memory","publicUrl":"https://linyeegiong.github.io/notes/agent-memory/"}\n',
        stderr: '',
      };
    };

    const result = await publishCurrentNote(obsidian.params);

    expect(result).toMatchObject({ ok: true, slug: 'agent-memory' });
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toContain('inspect');
    expect(calls[1].args).toContain('publish');
    expect(calls.every((call) => call.args.includes('--vault'))).toBe(true);
    expect(obsidian.notices.at(-1)).toContain('https://linyeegiong.github.io/notes/agent-memory/');
  });

  it('requires confirmation and passes the update flag only after approval', async () => {
    const obsidian = makeObsidian({ confirm: true });
    const calls: string[][] = [];
    obsidian.params.spawnProcess = async (_command: string, args: string[]) => {
      calls.push(args);
      const action = args.includes('inspect') ? 'update' : 'update';
      return {
        code: 0,
        stdout: `${JSON.stringify({ ok: true, action, slug: 'agent-memory', publicUrl: 'https://example.test' })}\n`,
        stderr: '',
      };
    };

    await publishCurrentNote(obsidian.params);

    expect(obsidian.params.quickAddApi.yesNoPrompt).toHaveBeenCalledOnce();
    expect(calls[1]).toContain('--confirm-update');
  });

  it('does not publish when an update is declined', async () => {
    const obsidian = makeObsidian({ confirm: false });
    const spawnProcess = vi.fn().mockResolvedValue({
      code: 0,
      stdout: '{"ok":true,"action":"update","slug":"agent-memory"}\n',
      stderr: '',
    });
    obsidian.params.spawnProcess = spawnProcess;

    const result = await publishCurrentNote(obsidian.params);

    expect(result).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(spawnProcess).toHaveBeenCalledOnce();
  });

  it('does not publish a new article until the user confirms it', async () => {
    const obsidian = makeObsidian({ confirm: false });
    const spawnProcess = vi.fn().mockResolvedValue({
      code: 0,
      stdout: '{"ok":true,"action":"create","slug":"docker-deployment"}\n',
      stderr: '',
    });
    obsidian.params.spawnProcess = spawnProcess;

    const result = await publishCurrentNote(obsidian.params);

    expect(result).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(obsidian.params.quickAddApi.yesNoPrompt).toHaveBeenCalledOnce();
    expect(spawnProcess).toHaveBeenCalledOnce();
  });

  it('shows a concise publisher error returned by the CLI', async () => {
    const obsidian = makeObsidian();
    obsidian.params.spawnProcess = async () => ({
      code: 1,
      stdout: '{"ok":false,"code":"INVALID_FRONTMATTER","message":"description 不能为空。"}\n',
      stderr: '',
    });

    const result = await publishCurrentNote(obsidian.params);

    expect(result).toMatchObject({ ok: false, code: 'INVALID_FRONTMATTER' });
    expect(obsidian.notices.at(-1)).toBe('发布失败：description 不能为空。');
  });
});
