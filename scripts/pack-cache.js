import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(projectRoot, 'data', 'tushare');
const outputDir = path.join(projectRoot, 'data-cache');
const outputFile = path.join(outputDir, 'tushare-cache.tar.gz');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(dataDir))) {
  throw new Error(`没有找到缓存目录：${dataDir}`);
}

await fs.mkdir(outputDir, { recursive: true });
await fs.rm(outputFile, { force: true });
await execFileAsync('tar', ['-czf', outputFile, '-C', path.join(projectRoot, 'data'), 'tushare']);

const stat = await fs.stat(outputFile);
console.log(`已生成 Git LFS 缓存包：${outputFile}`);
console.log(`大小：${(stat.size / 1024 / 1024).toFixed(2)} MB`);
