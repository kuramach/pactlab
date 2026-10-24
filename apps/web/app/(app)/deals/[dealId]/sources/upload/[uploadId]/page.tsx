import { IMPORT_TARGET_DEFINITIONS } from '@pactlab/domain';
import { Badge } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dealsApi } from '../../../../_lib/api';
import { isUuidParam } from '../../../../_lib/filters';
import { ApiState } from '../../../../_lib/states';
import { MappingEditor } from './mapping-editor';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const number = new Intl.NumberFormat('en-US');

/** Steps 2–3 of an import — billing or a pack extract (ADR 0010): map, check, import. */
export default async function MapUploadPage({ params }: { params: Promise<{ dealId: string; uploadId: string }> }) {
  const { dealId, uploadId } = await params;
  if (!isUuidParam(dealId) || !isUuidParam(uploadId)) notFound();
  const upload = await dealsApi.upload(dealId, uploadId);
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
          </p>
        ) : null}
      </header>
      {upload.kind !== 'ok' ? (
        <ApiState result={upload} />
      ) : upload.data.status === 'PURGED' ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          This upload was cancelled; nothing was imported and the stored file was deleted.
        </p>
      ) : (
        <MappingEditor
          dealId={dealId}
          uploadId={uploadId}
          header={upload.data.header}
          sample={upload.data.sample}
          suggested={upload.data.suggestedMapping}
        />
      )}
    </div>
  );
}
