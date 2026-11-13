/** The investment committee on a pact (T-118, ADR 0029). Buyer side only. */
export type IcStateView = 'NONE' | 'SUBMITTED' | 'APPROVED' | 'CONDITIONS_OPEN' | 'DECLINED';

export interface IcConditionView {
  id: string;
  text: string;
  status: 'OPEN' | 'ADDRESSED' | 'CLEARED';
  addressedByName: string | null;
  addressedAt: string | null;
  addressedNote: string | null;
  clearedByName: string | null;
  clearedAt: string | null;
}

export interface IcSubmissionView {
  id: string;
  version: number;
  reportId: string;
  reportStatus: string;
  submittedByName: string | null;
  submittedAt: string;
  decision: { decision: 'APPROVE' | 'APPROVE_WITH_CONDITIONS' | 'DECLINE'; note: string; decidedByName: string | null; decidedAt: string } | null;
  conditions: IcConditionView[];
}

export interface IcView {
  state: IcStateView;
  /** Signing waits for approval: the pact's own setting, else the organization's. */
  required: boolean;
  requirement: { pact: boolean | null; organization: boolean };
  clearsConditions: boolean;
  committee: { userId: string; name: string; source: 'ORGANIZATION' | 'PACT' }[];
  submissions: IcSubmissionView[];
  canSubmit: boolean;
  canDecide: boolean;
  canAddress: boolean;
  canClear: boolean;
  canSetRequirement: boolean;
}

export interface IcSettingsView {
  required: boolean;
  clearsConditions: boolean;
  members: { userId: string; name: string; role: string; investmentCommittee: boolean }[];
  canEdit: boolean;
}
