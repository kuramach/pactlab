import { IMPORT_TARGET_DEFINITIONS } from '../imports/targets';
import type { CompanyType } from '../pacts/types';
import { packFor } from './registry';

/**
 * The public synthetic demo data (https://github.com/kuramach/pactlab-demo-data), pinned to a
 * commit. The demo organizations are built from it, and the site's "Try it" page links to it.
 * Every name and figure in it is invented.
 */
export const DEMO_DATA_REPOSITORY = 'kuramach/pactlab-demo-data';
export const DEMO_DATA_COMMIT = '8d19312bf422d0a98379a5433d389d8b8afa37b1';

/** A file of a pack's demo data, at the pinned commit. */
export function demoDataUrl(type: CompanyType, path: string): string {
  return `https://raw.githubusercontent.com/${DEMO_DATA_REPOSITORY}/${DEMO_DATA_COMMIT}/${packFor(type).slug}/USD/${path}`;
}

/** The pack's folder on GitHub, to browse everything (documents included). */
export function demoDataFolderUrl(type: CompanyType): string {
  return `https://github.com/${DEMO_DATA_REPOSITORY}/tree/${DEMO_DATA_COMMIT}/${packFor(type).slug}/USD`;
}

/** What a person downloads to try a pack: the data room, and one extract per import target. */
export function demoDataFiles(type: CompanyType): { dataRoom: string; extracts: { label: string; fileName: string; url: string }[] } {
  return {
    dataRoom: demoDataUrl(type, 'dataroom.zip'),
    extracts: packFor(type).importTargets.map((target) => {
      const definition = IMPORT_TARGET_DEFINITIONS[target];
      return { label: definition.label, fileName: definition.fileName, url: demoDataUrl(type, definition.fileName) };
    }),
  };
}
