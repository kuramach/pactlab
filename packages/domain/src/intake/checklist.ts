import type { PackDefinition } from '../packs/registry';
import { categoryDefinition, type IntakeCategory } from './categories';
import type { IntakeState } from './decide';

/**
 * What a pact expects to receive. Most inputs are file categories; some are
 * only ever fed by a data connection (code and delivery from GitHub and Jira).
 */
export const CONNECTION_INPUTS = ['CODE_AND_DELIVERY'] as const;
export type ConnectionInput = (typeof CONNECTION_INPUTS)[number];
export type ExpectedInputId = IntakeCategory | ConnectionInput;

export interface ExpectedInput {
  readonly id: ExpectedInputId;
  readonly need: 'REQUIRED' | 'OPTIONAL';
}

/** Which inputs each connection provider feeds. A connected input is not asked for as files. */
export const CONNECTION_COVERAGE: Readonly<Record<string, readonly ExpectedInputId[]>> = {
  stripe: ['BILLING_INVOICE_LINE'],
  github: ['CODE_AND_DELIVERY'],
  jira: ['CODE_AND_DELIVERY'],
};

const CONNECTION_LABELS: Readonly<Record<ConnectionInput, string>> = {
  CODE_AND_DELIVERY: 'Code and delivery (GitHub, Jira)',
};

/** Connection providers that can feed an input, for the "connect or upload" offer. */
export function providersFor(input: ExpectedInputId): string[] {
  return Object.entries(CONNECTION_COVERAGE)
    .filter(([, inputs]) => inputs.includes(input))
    .map(([provider]) => provider);
}

export function expectedInputLabel(id: ExpectedInputId): string {
  return (CONNECTION_LABELS as Record<string, string>)[id] ?? categoryDefinition(id as IntakeCategory).label;
}

/**
 * A pack's expected inputs: the financial statements, the pack's own import
 * targets, and the documents its rules read. A pack may override the list
 * (`PackDefinition.expectedInputs`); otherwise it is derived here.
 */
export function expectedInputs(pack: PackDefinition): readonly ExpectedInput[] {
  if (pack.expectedInputs) return pack.expectedInputs;
  const technology = pack.cluster === 'technology';
  const realEstate = pack.cluster === 'real-estate';
  const inputs: ExpectedInput[] = [
    { id: 'INCOME_STATEMENT', need: 'REQUIRED' },
    { id: 'BALANCE_SHEET', need: 'REQUIRED' },
    ...pack.importTargets.map((target): ExpectedInput => ({
      id: target,
      // Every pack inherits the billing import from the software core; only software-like packs need it.
      need: target === 'BILLING_INVOICE_LINE' && !technology ? 'OPTIONAL' : 'REQUIRED',
    })),
    { id: 'CUSTOMER_CONTRACT', need: technology || pack.cluster === 'services' ? 'REQUIRED' : 'OPTIONAL' },
    { id: 'LEASE', need: realEstate ? 'REQUIRED' : 'OPTIONAL' },
    { id: 'LOAN_AGREEMENT', need: 'OPTIONAL' },
    { id: 'CASH_FLOW_STATEMENT', need: 'OPTIONAL' },
  ];
  if (pack.id === 'SOFTWARE_SAAS') inputs.push({ id: 'CODE_AND_DELIVERY', need: 'OPTIONAL' });
  return inputs;
}

export interface IntakeFile {
  readonly id: string;
  readonly fileName: string;
  readonly category: IntakeCategory | null;
  readonly intakeState: IntakeState;
}

export type ChecklistState = 'RECEIVED' | 'CONNECTED' | 'MISSING';

export interface ChecklistItem {
  readonly id: ExpectedInputId;
  readonly label: string;
  readonly need: 'REQUIRED' | 'OPTIONAL';
  readonly state: ChecklistState;
  /** Filed documents that satisfy it. */
  readonly documentIds: readonly string[];
  /** Active connections that feed it. */
  readonly connections: readonly string[];
  /** Providers that could feed it, offered when it is missing. */
  readonly connectable: readonly string[];
}

/**
 * The checklist: each expected input is received (filed documents), covered
 * by a connection, or missing. Only settled files count — a file still
 * waiting for a person does not tick anything off.
 */
export function intakeChecklist(
  pack: PackDefinition,
  files: readonly IntakeFile[],
  activeProviders: readonly string[],
): ChecklistItem[] {
  return expectedInputs(pack).map((input) => {
    const documentIds = files
      .filter((file) => file.intakeState === 'FILED' && file.category === input.id)
      .map((file) => file.id);
    const connections = activeProviders.filter((provider) => CONNECTION_COVERAGE[provider]?.includes(input.id));
    const state: ChecklistState = connections.length > 0 ? 'CONNECTED' : documentIds.length > 0 ? 'RECEIVED' : 'MISSING';
    return {
      id: input.id,
      label: expectedInputLabel(input.id),
      need: input.need,
      state,
      documentIds,
      connections,
      connectable: providersFor(input.id),
    };
  });
}

/** Plain-text request list for the counterparty, required items first. */
export function missingRequest(items: readonly ChecklistItem[]): string {
  const missing = items.filter((item) => item.state === 'MISSING');
  if (missing.length === 0) return 'Nothing is missing.';
  const lines = (need: ExpectedInput['need']) =>
    missing.filter((item) => item.need === need).map((item) => `- ${item.label}`);
  const required = lines('REQUIRED');
  const optional = lines('OPTIONAL');
  return [
    ...(required.length > 0 ? ['Please share:', ...required] : []),
    ...(optional.length > 0 ? [...(required.length > 0 ? [''] : []), 'If available, also:', ...optional] : []),
  ].join('\n');
}
