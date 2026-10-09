/** Plain-language deal labels shared by the deals list and the deal workspace. */
export const DEAL_TYPE_LABELS: Readonly<Record<string, string>> = {
  PUBLIC_ACQUIRER: 'Public acquirer',
  PRIVATE_ACQUIRER: 'Private acquisition',
  TAKE_PRIVATE: 'Take-private',
};

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  SCREENING: 'Screening',
  DILIGENCE: 'Diligence',
  NEGOTIATION: 'Negotiation',
  SIGNED: 'Signed',
  CLOSED: 'Closed',
};

export function partyLabel(party: { name: string; ticker: string | null }): string {
  return party.ticker ? `${party.name} (${party.ticker})` : party.name;
}
