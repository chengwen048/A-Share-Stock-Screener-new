import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archiveFile = path.join(projectRoot, 'data-cache', 'tushare-cache.tar.gz');
const dataRoot = path.join(projectRoot, 'data');
const dailyDir = path.join(dataRoot, 'tushare', 'daily');
const moneyflowDir = path.join(dataRoot, 'tushare', 'moneyflow');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(archiveFile))) {
  console.log('未发现 Git LFS 缓存包，跳过本地缓存恢复。');
  process.exit(0);
}

const hasDailyCache = await exists(dailyDir);
const hasMoneyflowCache = await exists(moneyflowDir);
if (hasDailyCache && hasMoneyflowCache) {
  console.log('本地 Tushare 缓存目录已存在，跳过解包。');
  process.exit(0);
}

await fs.mkdir(dataRoot, { recursive: true });
await execFileAsync('tar', ['-xzf', archiveFile, '-C', dataRoot]);
console.log(`已从 Git LFS 缓存包恢复数据：${archiveFile}`);
