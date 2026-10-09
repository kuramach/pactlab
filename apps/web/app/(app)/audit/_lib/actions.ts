/** Plain-language descriptions of audit actions; unknown actions fall back to a readable form. */
const KNOWN: Readonly<Record<string, string>> = {
  'pact.started': 'Started a Pact',
  'deal.created': 'Created a deal',
  'deal.updated': 'Updated a deal',
  'deal.member.added': 'Added a deal member',
  'deal.party.updated': 'Corrected a party',
  'connection.created': 'Connected a source',
  'connection.credential_stored': 'Stored a source credential',
  'connection.validated': 'Checked a connection',
  'connection.mode_changed': 'Changed a connection mode',
  'sync_run.requested': 'Synced a source',
  'source_upload.created': 'Uploaded a billing export',
  'source_upload.imported': 'Imported a billing export',
  'audit.read': 'Viewed the audit log',
};

export function describeAction(action: string): string {
  const known = KNOWN[action];
  if (known) return known;
  const words = action.replaceAll(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
