import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'vendor/pinqloq-backend');
const sdk = resolve(backend, 'sdk/pinqloq-node');
const expectedCommit = '53c7cfa6f6d3c09403cced2f432ea4680671fd93';
const packageDirectory = resolve(root, 'packages');
const packageManagerCandidates = [
  process.env.npm_execpath,
  resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
];
const packageManager = packageManagerCandidates.find(candidate => candidate && existsSync(candidate));
if (!packageManager) throw new Error('Run this script with npm run setup:sdk so the npm CLI can be located.');

function run(command, argumentsList, directory = root, capture = false) {
  const executable = command === 'npm' ? process.execPath : command;
  const parameters = command === 'npm' ? [packageManager, ...argumentsList] : argumentsList;
  const outputMode = capture ? 'pipe' : 'inherit';
  const result = spawnSync(executable, parameters, {
    cwd: directory, encoding: 'utf8', stdio: outputMode
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed; check the output above.`);
  return result.stdout?.trim();
}

run('git', ['submodule', 'update', '--init', 'vendor/pinqloq-backend']);
if (run('git', ['rev-parse', 'HEAD'], backend, true) !== expectedCommit) {
  throw new Error('SDK submodule does not match the pinned sample revision.');
}
run('npm', ['ci'], sdk);
run('npm', ['run', 'build'], sdk);
mkdirSync(packageDirectory, { recursive: true });
run('npm', ['pack', '--pack-destination', packageDirectory], sdk);
renameSync(resolve(packageDirectory, 'pinqloq-1.0.0.tgz'), resolve(packageDirectory, 'pinqloq-53c7cfa.tgz'));
run('npm', ['install']);
console.log('SDK installed as pinqloq. Commit the archive and package-lock.json together when updating it.');
