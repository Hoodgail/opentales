import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

export interface StoredAsset {
  bucket: string;
  key: string;
  absolutePath: string;
  sizeBytes: bigint;
}

export class LocalAssetStorage {
  static readonly bucket = 'local';

  private readonly root: string;

  constructor(root: string = env.assetsDir) {
    this.root = root;
  }

  async write(projectId: string, assetId: string, ext: string, data: Buffer): Promise<StoredAsset> {
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12) || 'bin';
    const dir = path.join(this.root, projectId);
    await fs.mkdir(dir, { recursive: true });
    const key = `${projectId}/${assetId}.${safeExt}`;
    const absolutePath = path.join(this.root, key);
    await fs.writeFile(absolutePath, data);
    return {
      bucket: LocalAssetStorage.bucket,
      key,
      absolutePath,
      sizeBytes: BigInt(data.length)
    };
  }

  pathForKey(key: string): string {
    return path.join(this.root, key);
  }

  async readStream(key: string) {
    const absolutePath = this.pathForKey(key);
    const handle = await fs.open(absolutePath, 'r');
    return handle.createReadStream();
  }

  async delete(key: string): Promise<void> {
    const absolutePath = this.pathForKey(key);
    await fs.rm(absolutePath, { force: true });
  }
}
