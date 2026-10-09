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

/** Steps 2–3 of a billing import: map, check, import. */
export default async function MapUploadPage({ params }: { params: Promise<{ dealId: string; uploadId: string }> }) {
  const { dealId, uploadId } = await params;
  if (!isUuidParam(dealId) || !isUuidParam(uploadId)) notFound();
  const upload = await dealsApi.upload(dealId, uploadId);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/deals/${dealId}/sources`} className="text-sm text-muted-foreground hover:underline">
          ← Sources
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">Map a billing export</h2>
        {upload.kind === 'ok' ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{upload.data.fileName}</span>
            <span>· {number.format(upload.data.rowCount)} rows</span>
            <span>· {upload.data.template.label}</span>
            {upload.data.template.verified ? (
              <Badge variant="calculation">Verified layout</Badge>
            ) : (
              <Badge>Suggested mapping — please check it</Badge>
            )}
            {upload.data.status === 'IMPORTED' ? <Badge variant="reviewed">Imported</Badge> : null}
          </p>
        ) : null}
      </header>
      {upload.kind !== 'ok' ? (
        <ApiState result={upload} />
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
