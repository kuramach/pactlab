export interface FeedBuild {
  target: string;
  signing: { codeSigned?: boolean };
  sums: Map<string, string>;
  files: { name: string; sizeBytes: number }[];
}
export interface FeedAsset {
  platform: 'macos-arm64' | 'macos-x64' | 'windows-x64' | 'linux-x64';
  url: string;
  sha256: string;
  sizeBytes: number;
  signed: boolean;
  minimumOs?: string;
}
export interface Feed {
  schema: 'pactlab-rinse-releases';
  version: 1;
  releases: { version: string; publishedAt: string; notes: string[]; assets: FeedAsset[] }[];
}
export function parseSums(text: string): Map<string, string>;
export function buildFeed(input: { builds: FeedBuild[]; version: string; baseUrl: string; publishedAt: string; notes: string[] }): Feed;
export function readBuilds(dir: string): FeedBuild[];
export function releaseName(name: string): string;
