import { Button } from '@pactlab/ui';
import { formsFor, type RinseGap } from '@pactlab/domain';
import type { FileView, RinseSet } from '../engine/rinse-set';
import { FlaskMark, type FlaskState } from './flask-mark';

export const RINSE_TAGLINE = 'Rinse your deal documents clean before they go in the room.';

type View = ReturnType<RinseSet['view']>;

export interface RinseScreenActions {
  readonly onAddFile?: (input: string) => void;
  readonly onEnterByHand?: (input: string, form: string) => void;
  readonly onMarkNotApplicable?: (input: string) => void;
  readonly onExclude?: (fileId: string) => void;
  readonly onRerun?: (fileId: string) => void;
  readonly onUpload?: () => void;
  readonly onChooseDestination?: (kind: DestinationKind) => void;
  /** The seller's own sign-in to their drive (T-178d): never the Pactlab login. */
  readonly onSignIn?: (kind: Exclude<DestinationKind, 'FOLDER'>) => void;
  readonly onSignOut?: (kind: Exclude<DestinationKind, 'FOLDER'>) => void;
}

export type DestinationKind = 'FOLDER' | 'ONEDRIVE' | 'GOOGLE_DRIVE' | 'BOX';

/** Where the finished set goes, and who it is signed in as there (null: not signed in yet). */
export interface DestinationChoice {
  readonly kind: DestinationKind;
  readonly signedInAs: string | null;
}

export const DESTINATION_LABELS: Readonly<Record<DestinationKind, string>> = { FOLDER: 'A folder', ONEDRIVE: 'OneDrive', GOOGLE_DRIVE: 'Google Drive', BOX: 'Box' };

/** Ready to upload: the set is clean, and a cloud destination is signed in. */
export const canUpload = (ready: boolean, destination: DestinationChoice) => ready && (destination.kind === 'FOLDER' || destination.signedInAs !== null);

function Destination({ destination, actions }: { destination: DestinationChoice; actions: RinseScreenActions }) {
  const cloud = destination.kind === 'FOLDER' ? null : destination.kind;
  return (
    <section aria-labelledby="destination" className="mt-6 rounded-2xl bg-white/10 p-5">
      <h3 id="destination" className="font-semibold">
        Where it goes
      </h3>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Destination">
        {(Object.keys(DESTINATION_LABELS) as DestinationKind[]).map((kind) => (
          <Button key={kind} variant={kind === destination.kind ? 'default' : 'outline'} aria-pressed={kind === destination.kind} onClick={() => actions.onChooseDestination?.(kind)}>
            {DESTINATION_LABELS[kind]}
          </Button>
        ))}
      </div>
      {cloud ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-300">
          {destination.signedInAs ? (
            <>
              <span>
                Signed in to {DESTINATION_LABELS[cloud]} as {destination.signedInAs}.
              </span>
              <Button variant="outline" onClick={() => actions.onSignOut?.(cloud)}>
                Sign out of {DESTINATION_LABELS[cloud]}
              </Button>
            </>
          ) : (
            <Button onClick={() => actions.onSignIn?.(cloud)}>Sign in to {DESTINATION_LABELS[cloud]}</Button>
          )}
          <p className="w-full">
            Your own {DESTINATION_LABELS[cloud]} sign-in, not your Pactlab login. The set is written to your account from this machine; Pactlab never gets access to your drive.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-300">A local or network folder. The set goes into a new folder of its own; nothing is overwritten.</p>
      )}
    </section>
  );
}

const GAP_LABELS: Readonly<Record<RinseGap['state'], string>> = {
  PRESENT: 'Present',
  PRESENT_FLAGGED: 'Present, flagged',
  HAND_SOURCED: 'Hand-sourced',
  NOT_APPLICABLE: 'Not applicable',
  NOTED: 'Noted',
  MISSING: 'Missing',
};

function Gap({ gap, actions }: { gap: RinseGap; actions: RinseScreenActions }) {
  return (
    <li className="flex items-start justify-between gap-6 border-b border-slate-100 py-4">
      <div>
        <p className="font-medium text-navy">{gap.label}</p>
        <p className="text-sm text-slate-500">
          {GAP_LABELS[gap.state]}
          {gap.need === 'OPTIONAL' ? ' · optional' : ''}
          {gap.note ? ` · ${gap.note}` : ''}
        </p>
      </div>
      {gap.state === 'MISSING' ? (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => actions.onAddFile?.(gap.input)}>
            Add the file
          </Button>
          {formsFor(gap.input).map((form) => (
            <Button key={form.id} size="sm" variant="outline" onClick={() => actions.onEnterByHand?.(gap.input, form.id)}>
              {form.id === 'ATTESTED_NOTE' ? 'Write an attested note' : 'Enter by hand'}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => actions.onMarkNotApplicable?.(gap.input)}>
            Not applicable
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** A conversion mismatch, side by side: the original's value against the converted value, page on each side. */
function Mismatches({ file }: { file: FileView }) {
  const mismatches = file.audit?.mismatches ?? [];
  if (mismatches.length === 0) return null;
  return (
    <table className="mt-3 w-full text-sm">
      <caption className="sr-only">Conversion mismatches in {file.path}</caption>
      <thead>
        <tr className="text-left text-slate-500">
          <th scope="col">Figure</th>
          <th scope="col">Original</th>
          <th scope="col">Converted</th>
        </tr>
      </thead>
      <tbody>
        {mismatches.map((mismatch) => (
          <tr key={`${mismatch.kind}:${mismatch.label}`}>
            <td>{mismatch.label}</td>
            <td className="tabular-nums">
              {mismatch.original.value}
              {mismatch.original.page ? ` · page ${mismatch.original.page}` : ''}
            </td>
            <td className="tabular-nums text-red-700">
              {mismatch.converted.value ?? 'missing'}
              {mismatch.converted.page ? ` · page ${mismatch.converted.page}` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReviewItem({ file, actions }: { file: FileView; actions: RinseScreenActions }) {
  const open = file.checks.filter((item) => item.severity !== 'INFO' && !item.resolution);
  if (file.excluded || open.length === 0) return null;
  return (
    <li className="rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="font-medium text-navy">{file.path}</p>
        <div className="flex gap-2">
          {file.audit && file.audit.mismatches.length > 0 ? (
            <Button size="sm" onClick={() => actions.onRerun?.(file.id)}>
              Re-run conversion
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => actions.onExclude?.(file.id)}>
            Leave out
          </Button>
        </div>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {open.map((item) => (
          <li key={`${item.code}:${item.message}`} className={item.severity === 'ERROR' ? 'text-red-700' : 'text-amber-700'}>
            {item.message}
          </li>
        ))}
      </ul>
      <Mismatches file={file} />
    </li>
  );
}

/** The bench: the flask, the checklist of what the pact expects, the review queue, and the upload. */
export function RinseScreen({ name, view, running, destination = { kind: 'FOLDER', signedInAs: null }, actions = {} }: { name: string; view: View; running: boolean; destination?: DestinationChoice; actions?: RinseScreenActions }) {
  const state: FlaskState = running ? 'working' : view.readiness.ready ? 'clean' : 'launch';
  return (
    <main className="mx-auto max-w-4xl px-10 py-12 font-[Manrope] text-navy">
      <header className="flex items-center gap-6">
        <FlaskMark state={state} size={96} />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pactlab Rinse</h1>
          <p className="text-slate-500">{RINSE_TAGLINE}</p>
        </div>
      </header>

      <section aria-labelledby="set" className="mt-10 rounded-3xl bg-navy p-8 text-white">
        <h2 id="set" className="text-xl font-semibold">
          {name}
        </h2>
        <p className="mt-1 text-slate-300" role="status">
          {running
            ? 'Rinsing: converting, checking and auditing every document on this machine.'
            : view.readiness.ready
              ? 'Clean. Every error is resolved and every gap is closed or noted.'
              : `${view.readiness.openErrors} to fix, ${view.readiness.openGaps.length} expected document${view.readiness.openGaps.length === 1 ? '' : 's'} missing.`}
          {view.aiWaiting > 0 ? ` ${view.aiWaiting} AI step${view.aiWaiting === 1 ? '' : 's'} wait until you are online and signed in.` : ''}
        </p>
        <Destination destination={destination} actions={actions} />
        <div className="mt-6">
          <Button disabled={!canUpload(view.readiness.ready, destination) || running} onClick={() => actions.onUpload?.()}>
            {destination.kind === 'FOLDER' ? 'Upload the finished set' : `Upload the finished set to ${DESTINATION_LABELS[destination.kind]}`}
          </Button>
        </div>
      </section>

      <section aria-labelledby="review" className="mt-10">
        <h2 id="review" className="text-lg font-semibold">
          To review
        </h2>
        <ul className="mt-4 space-y-4">
          {view.files.map((file) => (
            <ReviewItem key={file.id} file={file} actions={actions} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="checklist" className="mt-10">
        <h2 id="checklist" className="text-lg font-semibold">
          What the pact expects
        </h2>
        <ul className="mt-2">
          {view.gaps.map((gap) => (
            <Gap key={gap.input} gap={gap} actions={actions} />
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-500">
          Hand-sourced entries close a gap, and arrive in the pact as your claims, labelled hand-sourced: never as documentary evidence.
        </p>
      </section>
    </main>
  );
}
