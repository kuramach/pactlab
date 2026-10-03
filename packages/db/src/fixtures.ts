import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CsvDatasetMapping } from '@pactlab/domain';

/** Repository-relative root of the synthetic companies. Synthetic data only. */
export const SYNTHETIC_FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/synthetic',
);

export const SYNTHETIC_COMPANIES = ['HealthyCo', 'TroubledCo', 'SparseCo'] as const;
export type SyntheticCompany = (typeof SYNTHETIC_COMPANIES)[number];

export interface SyntheticManifest {
  manifestVersion: 1;
  company: SyntheticCompany;
  /** Stable cross-system identity: the same id in every provider fixture. */
  companyId: string;
  displayName: string;
  deal: {
    id: string;
    name: string;
    transactionType: 'PUBLIC_ACQUIRER' | 'PRIVATE_ACQUIRER' | 'TAKE_PRIVATE';
  };
  connection: { id: string; provider: 'csv'; displayName: string };
  datasets: CsvDatasetMapping[];
}

const DATASET_PATTERN = /^(HealthyCo|TroubledCo|SparseCo)\/[a-z0-9][a-z0-9-]*\.csv$/;

/** Dataset names are allow-listed shapes; nothing outside the fixture tree is readable. */
export function isSyntheticDataset(dataset: string): boolean {
  return DATASET_PATTERN.test(dataset);
}

export async function readSyntheticDataset(dataset: string): Promise<string> {
  if (!isSyntheticDataset(dataset)) throw new Error('Unknown synthetic dataset');
  const path = resolve(SYNTHETIC_FIXTURES_DIR, dataset);
  if (!path.startsWith(SYNTHETIC_FIXTURES_DIR + sep)) throw new Error('Unknown synthetic dataset');
  return readFile(path, 'utf8');
}

export async function loadSyntheticManifest(company: SyntheticCompany): Promise<SyntheticManifest> {
  const raw = await readFile(join(SYNTHETIC_FIXTURES_DIR, company, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as SyntheticManifest;
  if (manifest.manifestVersion !== 1 || manifest.company !== company)
    throw new Error(`Invalid manifest for ${company}`);
  for (const dataset of manifest.datasets) {
    if (!isSyntheticDataset(dataset.dataset) || !dataset.dataset.startsWith(`${company}/`)) {
      throw new Error(`Invalid dataset ${dataset.dataset} in ${company} manifest`);
    }
  }
  return manifest;
}
