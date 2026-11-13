/** Reports (T-110): one generated version, as the history lists it. */
export interface ReportVersionView {
  id: string;
  scope: 'EXECUTIVE' | 'PACT' | 'IC';
  dealId: string | null;
  dealName: string | null;
  version: number;
  status: 'GENERATING' | 'READY' | 'FAILED' | 'PURGED';
  generatedAt: string;
  generatedByName: string | null;
  dataAsOf: string;
  byteSize: number | null;
  sha256: string | null;
  captured: Record<string, unknown>;
}
