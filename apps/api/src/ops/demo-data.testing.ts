import { packFor, type CompanyType } from '@pactlab/domain';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DemoDataSource } from './demo-org';

/** The public demo data, generated as the pack acceptance tests do (the deployed run reads the same files at a pinned commit). */
export function generatedDemoData(): { source: DemoDataSource; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pactlab-demo-org-'));
  const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), dir], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
  const room = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/dataroom.py'), dir], { encoding: 'utf8' });
  if (room.status !== 0) throw new Error(`dataroom.py failed: ${room.stderr}`);
  const base = (type: CompanyType) => join(dir, packFor(type).slug, 'USD');
  return {
    dir,
    source: {
      file: async (type, path) => readFileSync(join(base(type), path)),
      documents: async (type) => readdirSync(join(base(type), 'documents')),
    },
  };
}

