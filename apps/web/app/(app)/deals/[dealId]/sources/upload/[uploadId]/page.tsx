import { IMPORT_TARGET_DEFINITIONS } from '@pactlab/domain';
import { Badge } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dealsApi } from '../../../../_lib/api';
import { isUuidParam } from '../../../../_lib/filters';
import { ApiState } from '../../../../_lib/states';
import { MappingEditor } from './mapping-editor';
import { ImportHistory, withdrawalFailure, WithdrawnPanel, WithdrawPanel } from './withdrawal';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const number = new Intl.NumberFormat('en-US');

/** Steps 2–3 of an import — billing or a pack extract (ADR 0010): map, check, import. */
export default async function MapUploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string; uploadId: string }>;
  searchParams: Promise<{ withdrawn?: string; voided?: string; findings?: string; runs?: string; withdraw?: string; reimport?: string; delete?: string }>;
}) {
  const { dealId, uploadId } = await params;
  const query = await searchParams;
  if (!isUuidParam(dealId) || !isUuidParam(uploadId)) notFound();
  const upload = await dealsApi.upload(dealId, uploadId);
  // Deleting and importing again: whoever imported it, or the deal lead or an analyst (the API decides and says so).
  const canManage = upload.kind === 'ok' && upload.data.canDelete;
  const inChain = upload.kind === 'ok' && (upload.data.status === 'WITHDRAWN' || upload.data.supersedesUploadId !== null);
  const history = canManage && inChain ? await dealsApi.uploadHistory(dealId, uploadId) : null;
  const chain = history?.kind === 'ok' ? history.data.chain : null;
  const failure = withdrawalFailure(query.withdraw ?? query.reimport);
  const definition = upload.kind === 'ok' ? IMPORT_TARGET_DEFINITIONS[upload.data.target] : null;
  const billing = !definition || definition.target === 'BILLING_INVOICE_LINE';

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/deals/${dealId}/sources`} className="text-sm text-muted-foreground hover:underline">
          ← Sources
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">{billing ? 'Map a billing export' : `Map a ${definition?.label.toLowerCase() ?? 'file'}`}</h2>
        {upload.kind === 'ok' ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{upload.data.fileName}</span>
            <span>· {number.format(upload.data.rowCount)} rows</span>
            {billing ? (
              <>
                <span>· {upload.data.template.label}</span>
                {upload.data.template.verified ? <Badge variant="calculation">Verified layout</Badge> : <Badge>Suggested mapping — please check it</Badge>}
              </>
            ) : (
              <>
                <span>· Pactlab standard template</span>
                <Badge>Suggested mapping — please check it</Badge>
              </>
            )}
            {upload.data.status === 'IMPORTED' ? <Badge variant="reviewed">Imported</Badge> : null}
            {upload.data.status === 'WITHDRAWN' ? <Badge variant="danger">Deleted</Badge> : null}
            {upload.data.supersedesUploadId ? <Badge>Re-import</Badge> : null}
          </p>
        ) : null}
      </header>
      {failure ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {failure}
        </p>
      ) : null}
      {upload.kind !== 'ok' ? (
        <ApiState result={upload} />
      ) : upload.data.status === 'WITHDRAWN' ? (
        <WithdrawnPanel
          dealId={dealId}
          uploadId={uploadId}
          chain={chain}
          supersededByUploadId={upload.data.supersededByUploadId}
          canManage={canManage}
          done={query.withdrawn ? { voided: Number(query.voided ?? 0), findings: Number(query.findings ?? 0), runs: Number(query.runs ?? 0) } : null}
        />
      ) : upload.data.status === 'PURGED' ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          This upload was cancelled; nothing was imported and the stored file was deleted.
        </p>
      ) : (
        <>
        {chain && chain.length > 1 ? <ImportHistory dealId={dealId} chain={chain} current={uploadId} /> : null}
        {upload.data.status === 'IMPORTED' && canManage ? <WithdrawPanel dealId={dealId} uploadId={uploadId} open={query.delete === '1' || failure !== null} /> : null}
        <MappingEditor
          // A different sheet is a different table: start the mapping afresh.
          key={`${upload.data.sheet ?? 'table'}:${upload.data.headerRow ?? 1}`}
          dealId={dealId}
          uploadId={uploadId}
          header={upload.data.header}
          sample={upload.data.sample}
          suggested={upload.data.suggestedMapping}
          read={upload.data}
          assist={upload.data.assist}
          guidance={upload.data.guidance}
          headerRow={upload.data.headerRow}
          preview={upload.data.preview}
        />
        </>
      )}
    </div>
  );
}
