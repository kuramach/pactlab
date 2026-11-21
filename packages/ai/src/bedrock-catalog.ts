import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand, type FoundationModelSummary } from '@aws-sdk/client-bedrock';

/** A model this account can use on Bedrock: the id to call (a system inference profile when one exists). */
export interface BedrockCatalogEntry {
  /** What Converse is called with: a system inference profile id (e.g. `us.…`) or an on-demand model id. */
  readonly modelId: string;
  /** The model's maker, as Bedrock names it (Anthropic, OpenAI, Google, Meta, Mistral AI, Amazon, …). */
  readonly maker: string;
  readonly name: string;
  /** Whether it takes images (Bedrock's input modalities). */
  readonly readsImages: boolean;
}

/** Bedrock's model list for one region, behind a seam (a fixed list in tests and local work). */
export interface BedrockCatalog {
  list(): Promise<BedrockCatalogEntry[]>;
}

const entry = (modelId: string, summary: FoundationModelSummary): BedrockCatalogEntry => ({
  modelId,
  maker: summary.providerName ?? 'Unknown',
  name: summary.modelName ?? modelId,
  readsImages: (summary.inputModalities ?? []).includes('IMAGE'),
});

/**
 * Bedrock's active text models for the region (ListFoundationModels), each by the id Converse takes: its
 * system-defined inference profile when it has one (ListInferenceProfiles), else its on-demand model id.
 * A model reachable only through provisioned throughput is left out.
 */
export class AwsBedrockCatalog implements BedrockCatalog {
  private readonly client: BedrockClient;

  constructor(region: string) {
    this.client = new BedrockClient({ region });
  }

  async list(): Promise<BedrockCatalogEntry[]> {
    const summaries = (await this.client.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' }))).modelSummaries ?? [];
    const active = summaries.filter((m) => m.modelId && m.modelLifecycle?.status !== 'LEGACY' && (m.inputModalities ?? []).includes('TEXT'));
    const entries = new Map<string, BedrockCatalogEntry>();
    const viaProfile = new Set<string>();
    let nextToken: string | undefined;
    do {
      const page = await this.client.send(new ListInferenceProfilesCommand({ typeEquals: 'SYSTEM_DEFINED', maxResults: 100, ...(nextToken ? { nextToken } : {}) }));
      for (const profile of page.inferenceProfileSummaries ?? []) {
        if (profile.status !== 'ACTIVE' || !profile.inferenceProfileId) continue;
        const arn = profile.models?.[0]?.modelArn ?? '';
        const base = active.find((m) => arn.endsWith(`/${m.modelId}`));
        if (!base?.modelId) continue;
        viaProfile.add(base.modelId);
        entries.set(profile.inferenceProfileId, entry(profile.inferenceProfileId, base));
      }
      nextToken = page.nextToken;
    } while (nextToken);
    for (const model of active) {
      if (!model.modelId || viaProfile.has(model.modelId) || !(model.inferenceTypesSupported ?? []).includes('ON_DEMAND')) continue;
      entries.set(model.modelId, entry(model.modelId, model));
    }
    return [...entries.values()].sort((a, b) => a.maker.localeCompare(b.maker) || a.name.localeCompare(b.name));
  }
}

/** Tests and local work: a fixed list. */
export class FixtureBedrockCatalog implements BedrockCatalog {
  constructor(private readonly entries: readonly BedrockCatalogEntry[]) {}
  async list(): Promise<BedrockCatalogEntry[]> {
    return [...this.entries];
  }
}
