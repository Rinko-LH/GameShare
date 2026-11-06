/** Build a Windows x64 application directory without creating or running an installer. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');
const releaseRoot = path.resolve(root, '..', 'release');
const env = {
  ...process.env,
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE ?? path.join(root, '.cache', 'electron-builder'),
};

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Build failed (${code})`)));
  });
}

async function main() {
  if (process.argv.length > 2) throw new Error('build:folder takes no arguments and only produces a Windows x64 folder');
  const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
  for (const required of [
    path.join(electronDist, 'electron.exe'),
    path.join(root, 'tools', 'cloudflared.exe'),
    path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
  ]) {
    if (!existsSync(required)) throw new Error(`Missing build dependency: ${required}`);
  }
  // Always use a new build directory, so an existing running copy is never overwritten.
  let output = path.join(releaseRoot, 'release-folder');
  for (let index = 2; existsSync(output); index++) output = path.join(releaseRoot, `release-folder-${index}`);
  await run([path.join(desktop, 'scripts', 'build-electron.mjs')], desktop);
  await run([path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], desktop);
  await run([
    path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
    '--win', '--x64', '--dir',
    `--config.electronDist=${electronDist}`,
    `--config.directories.output=${output}`,
  ], desktop);
  console.log(`Folder build ready: ${path.join(output, 'win-unpacked')}`);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
