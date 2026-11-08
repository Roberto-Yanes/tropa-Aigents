import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { processCall } from './providers.mjs';

export function linuxGoogleVault(dir) {
  const id = createHash('sha256').update(dir).digest('hex');
  const helper = fileURLToPath(new URL('./google-vault.py', import.meta.url));
  const call = (operation, input = '') => processCall('python3', [helper, operation, id], { input, timeout: 10000 });
  return {
    async load() { return JSON.parse(await call('load')); },
    async save(value) { await call('save', JSON.stringify(value)); },
    async delete() { await call('delete'); }
  };
}
