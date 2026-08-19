import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { PublishError } from './content.mjs';

export function runProcess(command, args, { cwd, allowFailure = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
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
    child.on('error', (error) => reject(new PublishError(
      'COMMAND_NOT_FOUND',
      `无法启动 ${command}：${error.message}`,
      { command, args },
    )));
    child.on('close', (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !allowFailure) {
        reject(new PublishError('COMMAND_FAILED', `${command} 执行失败。`, {
          command,
          args,
          exitCode: result.code,
          stderr: stderr.trim(),
        }));
      } else {
        resolve(result);
      }
    });
  });
}

export function runGit(args, options = {}) {
  return runProcess('git', args, options);
}

export function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return runProcess(process.execPath, [npmCli, ...args], options);
  }
  return runProcess('npm', args, options);
}

function normalizeRemote(remote) {
  return remote.replaceAll('\\', '/').replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase();
}

export async function ensureRepository({ blogRoot, expectedRemote, gitRunner = runGit }) {
  const rootResult = await gitRunner(['rev-parse', '--show-toplevel'], { cwd: blogRoot });
  const [actualRoot, expectedRoot] = await Promise.all([
    realpath(rootResult.stdout.trim()),
    realpath(blogRoot),
  ]);
  if (path.normalize(actualRoot).toLowerCase() !== path.normalize(expectedRoot).toLowerCase()) {
    throw new PublishError('GIT_REPOSITORY_MISMATCH', '目标目录不是博客 Git 仓库根目录。');
  }

  const branch = (await gitRunner(['branch', '--show-current'], { cwd: blogRoot })).stdout.trim();
  if (branch !== 'main') {
    throw new PublishError('GIT_BRANCH', `博客仓库必须位于 main 分支，当前为 ${branch || 'detached HEAD'}。`);
  }
  const upstream = (await gitRunner(['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: blogRoot })).stdout.trim();
  if (upstream !== 'origin/main') {
    throw new PublishError('GIT_UPSTREAM', 'main 分支必须跟踪 origin/main。');
  }
  const status = (await gitRunner(['status', '--porcelain'], { cwd: blogRoot })).stdout.trim();
  if (status) {
    throw new PublishError('GIT_DIRTY', '博客仓库存在未提交修改，请先处理后再发布。', { status });
  }

  const remote = (await gitRunner(['remote', 'get-url', 'origin'], { cwd: blogRoot })).stdout.trim();
  if (expectedRemote) {
    if (normalizeRemote(remote) !== normalizeRemote(expectedRemote)) {
      throw new PublishError('GIT_REMOTE', 'origin 不是预期的博客仓库。', { remote });
    }
  } else if (!/(?:github\.com[:/])linyeegiong\/linyeegiong\.github\.io(?:\.git)?$/i.test(remote)) {
    throw new PublishError('GIT_REMOTE', 'origin 必须指向 LinYeeGiong/LinYeeGiong.github.io。', { remote });
  }

  const name = (await gitRunner(['config', 'user.name'], { cwd: blogRoot })).stdout.trim();
  const email = (await gitRunner(['config', 'user.email'], { cwd: blogRoot })).stdout.trim();
  if (name !== 'LinYeeGiong' || email !== 'linyifeng@stu.xmu.edu.cn') {
    throw new PublishError('GIT_IDENTITY', 'Git 身份必须是 LinYeeGiong <linyifeng@stu.xmu.edu.cn>。', {
      name,
      email,
    });
  }
}
