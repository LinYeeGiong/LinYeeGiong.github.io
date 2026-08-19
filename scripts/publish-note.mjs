#!/usr/bin/env node
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultBlogRoot = path.resolve(scriptRoot, '..');

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags };
}

async function ensureDependencies(blogRoot) {
  try {
    await access(path.join(blogRoot, 'node_modules', 'gray-matter', 'package.json'));
    return;
  } catch {
    // First use on a fresh clone installs the lockfile without opening a shell window.
  }
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const command = process.platform === 'win32' ? process.execPath : 'npm';
  const args = process.platform === 'win32' ? [npmCli, 'ci'] : ['ci'];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: blogRoot, shell: false, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`npm ci exited with ${code}`)));
  });
}

async function main() {
  const { command, flags } = parseArguments(process.argv.slice(2));
  const blogRoot = path.resolve(String(flags.blog || defaultBlogRoot));
  const vaultRoot = flags.vault ? path.resolve(String(flags.vault)) : null;
  if (!vaultRoot || !flags.note || !['inspect', 'publish'].includes(command)) {
    throw Object.assign(new Error('用法：publish-note.mjs <inspect|publish> --vault <path> --note <relative> [--json]'), {
      code: 'INVALID_ARGUMENTS',
    });
  }
  await ensureDependencies(defaultBlogRoot);
  const { inspectPublication, executePublication } = await import('./publish/transaction.mjs');
  const sourcePath = path.resolve(vaultRoot, String(flags.note));
  if (command === 'inspect') {
    const plan = await inspectPublication({ sourcePath, vaultRoot, blogRoot });
    return {
      ok: true,
      phase: 'inspect',
      action: plan.action,
      slug: plan.slug,
      kind: plan.kind,
      publicUrl: plan.publicUrl,
    };
  }
  return executePublication({
    sourcePath,
    vaultRoot,
    blogRoot,
    confirmUpdate: Boolean(flags['confirm-update']),
  });
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const result = {
    ok: false,
    code: error.code ?? 'PUBLISH_FAILED',
    message: error.message,
    details: error.details ?? {},
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
}
