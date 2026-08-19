const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findNode() {
  if (process.env.ORBITALE_NODE) return process.env.ORBITALE_NODE;
  const candidates = process.platform === 'win32'
    ? [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'),
      ]
    : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || 'node';
}

function spawnProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseResult(stdout) {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('发布器没有返回结果。');
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`发布器返回了无法识别的结果：${line}`);
  }
}

function defaultNotice(message) {
  const { Notice } = require('obsidian');
  new Notice(message, 8000);
}

module.exports = async function publishCurrentNote(params) {
  const { app, quickAddApi } = params;
  const showNotice = params.showNotice || defaultNotice;
  const runner = params.spawnProcess || spawnProcess;

  try {
    const activeFile = app.workspace.getActiveFile();
    if (!activeFile || !['md', 'mdx'].includes(activeFile.extension)) {
      const result = { ok: false, code: 'NO_ACTIVE_NOTE', message: '请先打开一篇 Markdown 笔记。' };
      showNotice(`发布失败：${result.message}`);
      return result;
    }
    const vaultRoot = app.vault.adapter.basePath;
    if (!vaultRoot) {
      const result = { ok: false, code: 'DESKTOP_ONLY', message: '一键发布目前仅支持 Windows 和 macOS 桌面端。' };
      showNotice(`发布失败：${result.message}`);
      return result;
    }

    const blogRoot = path.join(path.dirname(vaultRoot), 'LinYeeGiong.github.io');
    const cliPath = path.join(blogRoot, 'scripts', 'publish-note.mjs');
    const node = findNode();
    const common = ['--vault', vaultRoot, '--note', activeFile.path, '--blog', blogRoot, '--json'];

    showNotice('正在检查文章和图片...');
    const inspectionProcess = await runner(node, [cliPath, 'inspect', ...common], { cwd: blogRoot });
    const inspection = parseResult(inspectionProcess.stdout);
    if (!inspection.ok) {
      showNotice(`发布失败：${inspection.message}`);
      return inspection;
    }

    if (inspection.action === 'update') {
      const confirmed = await quickAddApi.yesNoPrompt(
        '更新已有文章？',
        `即将更新 /${inspection.kind}/${inspection.slug}/ 及其图片。`,
      );
      if (!confirmed) {
        const result = { ok: false, code: 'CANCELLED', message: '已取消更新。' };
        showNotice(result.message);
        return result;
      }
    }

    showNotice('正在验证、提交并推送文章...');
    const publishArgs = [cliPath, 'publish', ...common];
    if (inspection.action === 'update') publishArgs.push('--confirm-update');
    const publishProcess = await runner(node, publishArgs, { cwd: blogRoot });
    const result = parseResult(publishProcess.stdout);
    if (!result.ok) {
      showNotice(`发布失败：${result.message}`);
      return result;
    }
    showNotice(`发布成功：${result.publicUrl}`);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      code: error.code || 'OBSIDIAN_BRIDGE_FAILED',
      message: error.message || String(error),
    };
    showNotice(`发布失败：${result.message}`);
    return result;
  }
};

module.exports.parseResult = parseResult;
