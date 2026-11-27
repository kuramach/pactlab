import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@pactlab/ui';
import { COMPANY_TYPE_LABELS, HAND_ENTRY_FORMS, RELEASED_COMPANY_TYPES, type HandEntryFormId, type HandFieldProblem } from '@pactlab/domain';
import type { PreparerBindingView } from '@pactlab/contracts';
import type { RinseSet } from '../engine/rinse-set';
import { FlaskMark } from './flask-mark';
import { DESTINATION_LABELS, RINSE_TAGLINE, RinseScreen, type DestinationChoice, type DestinationKind } from './rinse-screen';
import { messageFor, SidecarFailure, type SidecarClient } from './sidecar-client';
import { inviteToken } from './tauri';

/**
 * The Rinse window (T-178e): sign in from a prep invite, open the seller's folder, rinse (the flask at
 * work), close the gaps (a file, a hand entry, a note), then write the finished folder or upload it to
 * the seller's own drive. Every step is a command to the engine sidecar; the window keeps no token.
 */
export interface SessionStatus {
  signedIn: boolean;
  email: string | null;
  name: string | null;
  organization: string | null;
  bindings: PreparerBindingView[];
  waiting: number;
}

type View = ReturnType<RinseSet['view']>;
export type BenchState = { open: false } | { open: true; name: string; view: View; written: { location: string; written: number } | null; problems?: HandFieldProblem[] };
export interface CloudState {
  provider: Exclude<DestinationKind, 'FOLDER'>;
  registered: boolean;
  signedIn: boolean;
  pending: boolean;
  failed: string | null;
}

export interface Platform {
  chooseFolder(title: string): Promise<string | null>;
  chooseFile(title: string): Promise<string | null>;
  openInBrowser(url: string): Promise<void>;
  onInvite(listener: (token: string) => void): Promise<void>;
  online(): boolean;
}

const CURRENCIES = ['USD', 'GBP', 'EUR', 'JPY', 'INR'] as const;
const field = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-navy focus:outline-2 focus:outline-indigo';

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-cloud">{children}</div>;
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {text}
    </p>
  ) : null;
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-4 block text-sm font-medium text-navy">
      {label}
      {children}
    </label>
  );
}

/** Sign-in: the invite link, an emailed code, and how the preparer is named on every set. */
export function SignInScreen({ invite, busy, error, codeSent, onSend, onVerify }: { invite: string; busy: boolean; error: string | null; codeSent: boolean; onSend: (input: { invite: string; email: string; name: string; organization: string }) => void; onVerify: (code: string) => void }) {
  const [form, setForm] = useState({ invite, email: '', name: '', organization: '' });
  const [code, setCode] = useState('');
  useEffect(() => setForm((current) => ({ ...current, invite: invite || current.invite })), [invite]);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const send = (event: FormEvent) => {
    event.preventDefault();
    onSend(form);
  };
  const verify = (event: FormEvent) => {
    event.preventDefault();
    onVerify(code);
  };
  return (
    <main className="mx-auto max-w-lg px-10 py-16 font-[Manrope] text-navy">
      <header className="flex items-center gap-5">
        <FlaskMark state="launch" size={72} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pactlab Rinse</h1>
          <p className="text-slate-500">{RINSE_TAGLINE}</p>
        </div>
      </header>
      {codeSent ? (
        <form onSubmit={verify} className="mt-10 rounded-3xl bg-white p-8 shadow-sm">
          <h2 className="text-lg font-semibold">Enter the code we emailed you</h2>
          <p className="mt-1 text-sm text-slate-500">It was sent to {form.email}. It works for 10 minutes.</p>
          <Labelled label="Code">
            <input className={field} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />
          </Labelled>
          <Problem text={error} />
          <div className="mt-6">
            <Button type="submit" disabled={busy || code.length !== 6}>
              Sign in
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={send} className="mt-10 rounded-3xl bg-white p-8 shadow-sm">
          <h2 className="text-lg font-semibold">Sign in with your prep invite</h2>
          <p className="mt-1 text-sm text-slate-500">The deal team sent you an invite. Your free account sees nothing of the pact; it only lets Pactlab accept the set you prepare.</p>
          <Labelled label="Invite link">
            <input className={field} value={form.invite} onChange={set('invite')} placeholder="https://pactlab.ai/rinse?invite=…" required />
          </Labelled>
          <Labelled label="Your email (the address the invite went to)">
            <input className={field} type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
          </Labelled>
          <Labelled label="Your name">
            <input className={field} autoComplete="name" value={form.name} onChange={set('name')} maxLength={200} required />
          </Labelled>
          <Labelled label="Your company">
            <input className={field} autoComplete="organization" value={form.organization} onChange={set('organization')} maxLength={200} required />
          </Labelled>
          <p className="mt-3 text-sm text-slate-500">Your name and company are stamped on the set and on anything you enter by hand.</p>
          <Problem text={error} />
          <div className="mt-6">
            <Button type="submit" disabled={busy}>
              Email me a code
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}

/** Set-up: which pact, what kind of company, the currency, then the folder. */
export function SetUpScreen({ session, busy, error, onOpen, onSignOut }: { session: SessionStatus; busy: boolean; error: string | null; onOpen: (input: { bindingId: string | null; name: string; companyType: string; currency: string }) => void; onSignOut: () => void }) {
  const first = session.bindings[0];
  const [form, setForm] = useState({ bindingId: first?.bindingId ?? '', name: first ? `${first.pactName} documents` : '', companyType: 'MULTIFAMILY', currency: 'USD' });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onOpen({ ...form, bindingId: form.bindingId || null });
  };
  return (
    <main className="mx-auto max-w-xl px-10 py-16 font-[Manrope] text-navy">
      <header className="flex items-center justify-between gap-5">
        <div className="flex items-center gap-5">
          <FlaskMark state="launch" size={64} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Open a folder to rinse</h1>
            <p className="text-sm text-slate-500">
              Signed in as {session.name} ({session.organization}), {session.email}
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </header>
      <form onSubmit={submit} className="mt-10 rounded-3xl bg-white p-8 shadow-sm">
        <Labelled label="The pact this set is for">
          <select className={field} value={form.bindingId} onChange={set('bindingId')}>
            {session.bindings.map((binding) => (
              <option key={binding.bindingId} value={binding.bindingId}>
                {binding.pactName} (invited by {binding.invitedBy})
              </option>
            ))}
            <option value="">Not for a pact yet</option>
          </select>
        </Labelled>
        <Labelled label="Name of the set">
          <input className={field} value={form.name} onChange={set('name')} maxLength={200} required />
        </Labelled>
        <Labelled label="What the company is">
          <select className={field} value={form.companyType} onChange={set('companyType')}>
            {RELEASED_COMPANY_TYPES.map((type) => (
              <option key={type} value={type}>
                {COMPANY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Currency of the figures">
          <select className={field} value={form.currency} onChange={set('currency')}>
            {CURRENCIES.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </Labelled>
        <p className="mt-4 text-sm text-slate-500">Rinse reads the folder on this machine. Originals are never changed; canonical copies are written beside them only when you finish.</p>
        <Problem text={error} />
        <div className="mt-6">
          <Button type="submit" disabled={busy}>
            Choose the folder
          </Button>
        </div>
      </form>
    </main>
  );
}

/** Enter a document by hand: the form's own fields, one row or several. Rinse stamps the result. */
export function HandEntryPanel({ form, problems, busy, onSave, onCancel }: { form: HandEntryFormId; problems: readonly HandFieldProblem[]; busy: boolean; onSave: (rows: Record<string, string>[]) => void; onCancel: () => void }) {
  const spec = HAND_ENTRY_FORMS[form];
  const [rows, setRows] = useState<Record<string, string>[]>([{}]);
  const change = (index: number, key: string, value: string) => setRows(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
  const problemFor = (row: number, key: string) => problems.find((problem) => problem.row === row + 1 && problem.field === key);
  return (
    <section aria-labelledby="hand-entry" className="mx-auto mt-8 max-w-4xl rounded-3xl bg-white p-8 font-[Manrope] text-navy shadow-sm">
      <h2 id="hand-entry" className="text-lg font-semibold">
        {spec.label}
      </h2>
      <p className="mt-1 text-sm text-slate-500">Rinse makes a document of what you enter, stamped “Hand-sourced — entered by you” on every page. It arrives in the pact as your claim, never as documentary evidence.</p>
      {rows.map((row, index) => (
        <fieldset key={index} className="mt-4 grid grid-cols-2 gap-x-4 border-t border-slate-100 pt-2">
          <legend className="sr-only">Row {index + 1}</legend>
          {spec.fields.map((entry) => (
            <Labelled key={entry.key} label={`${entry.label}${entry.required ? '' : ' (optional)'}`}>
              <input className={field} value={row[entry.key] ?? ''} onChange={(event) => change(index, entry.key, event.target.value)} aria-invalid={problemFor(index, entry.key) ? true : undefined} />
              {problemFor(index, entry.key) ? <span className="text-xs text-rose-700">{problemFor(index, entry.key)?.problem === 'REQUIRED' ? 'Required' : 'Check this value'}</span> : null}
            </Labelled>
          ))}
        </fieldset>
      ))}
      <div className="mt-6 flex gap-2">
        <Button disabled={busy} onClick={() => onSave(rows)}>
          Save the entry
        </Button>
        {spec.rows ? (
          <Button variant="outline" onClick={() => setRows([...rows, {}])}>
            Add a row
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** A note for a gap: not applicable, with why. Errors can never be noted away. */
export function NotePanel({ label, busy, onSave, onCancel }: { label: string; busy: boolean; onSave: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  return (
    <section aria-labelledby="gap-note" className="mx-auto mt-8 max-w-4xl rounded-3xl bg-white p-8 font-[Manrope] text-navy shadow-sm">
      <h2 id="gap-note" className="text-lg font-semibold">
        {label}: not applicable
      </h2>
      <Labelled label="Why (the deal team sees this note)">
        <textarea className={field} rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Labelled>
      <div className="mt-6 flex gap-2">
        <Button disabled={busy || note.trim().length < 3} onClick={() => onSave(note)}>
          Save the note
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

type Panel = { kind: 'hand'; form: HandEntryFormId } | { kind: 'note'; input: string; label: string } | null;

export function App({ client, platform }: { client: SidecarClient; platform: Platform }) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [bench, setBench] = useState<BenchState>({ open: false });
  const [cloud, setCloud] = useState<CloudState[]>([]);
  const [destination, setDestination] = useState<DestinationKind>('FOLDER');
  const [invite, setInvite] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [pending, setPending] = useState<{ invite: string; email: string; name: string; organization: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const attempt = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (failure) {
      setError(messageFor(failure));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void attempt(async () => setSession(await client.ask<SessionStatus>('session.status')));
    void platform.onInvite((token) => setInvite(token));
  }, [attempt, client, platform]);

  // A drive sign-in finishes in the seller's browser; the engine says when.
  useEffect(() => {
    if (!cloud.some((entry) => entry.pending)) return;
    const timer = setInterval(() => void client.ask<{ cloud: CloudState[] }>('cloud.status').then((state) => setCloud(state.cloud)), 1500);
    return () => clearInterval(timer);
  }, [client, cloud]);

  const rinse = async () => {
    setRunning(true);
    await attempt(async () => setBench(await client.ask<BenchState>('set.rinse', { online: platform.online() })));
    setRunning(false);
  };
  const benchCommand = (command: string, fields: Record<string, unknown> = {}) =>
    attempt(async () => {
      const next = await client.ask<BenchState>(command, fields);
      setBench(next);
      return next;
    });

  if (!session) return <Shell>{error ? <Problem text={error} /> : <p className="p-10 text-slate-500">Starting Pactlab Rinse…</p>}</Shell>;

  if (!session.signedIn)
    return (
      <Shell>
        <SignInScreen
          invite={invite}
          busy={busy}
          error={error}
          codeSent={codeSent}
          onSend={(input) =>
            void attempt(async () => {
              const token = inviteToken(input.invite);
              if (!token) throw new SidecarFailure('PREP_INVITE_UNAVAILABLE');
              await client.ask('session.start', { token, email: input.email, displayName: input.name });
              setPending({ ...input, invite: token });
              setCodeSent(true);
            })
          }
          onVerify={(code) =>
            void attempt(async () => {
              if (!pending) return;
              setSession(await client.ask<SessionStatus>('session.verify', { token: pending.invite, email: pending.email, code, name: pending.name, organization: pending.organization }));
            })
          }
        />
      </Shell>
    );

  if (!bench.open)
    return (
      <Shell>
        <SetUpScreen
          session={session}
          busy={busy}
          error={error}
          onSignOut={() => void attempt(async () => setSession(await client.ask<SessionStatus>('session.signOut')))}
          onOpen={(input) =>
            void attempt(async () => {
              const folder = await platform.chooseFolder('The folder of documents to rinse');
              if (!folder) return;
              setBench(await client.ask<BenchState>('set.open', { ...input, folder }));
              setCloud((await client.ask<{ cloud: CloudState[] }>('cloud.status')).cloud);
            }).then(() => rinse())
          }
        />
      </Shell>
    );

  const cloudEntry = destination === 'FOLDER' ? null : cloud.find((entry) => entry.provider === destination);
  const choice: DestinationChoice = { kind: destination, signedInAs: cloudEntry?.signedIn ? 'your own account' : null };
  const label = (input: string) => bench.view.gaps.find((gap) => gap.input === input)?.label ?? input;

  return (
    <Shell>
      {panel?.kind === 'hand' ? (
        <HandEntryPanel
          form={panel.form}
          problems={bench.problems ?? []}
          busy={busy}
          onCancel={() => setPanel(null)}
          onSave={(rows) =>
            void benchCommand('set.handEntry', { form: panel.form, rows, entryId: null }).then((next) => {
              if (next?.open && (next.problems ?? []).length === 0) setPanel(null);
            })
          }
        />
      ) : null}
      {panel?.kind === 'note' ? <NotePanel label={panel.label} busy={busy} onCancel={() => setPanel(null)} onSave={(note) => void benchCommand('set.noteGap', { input: panel.input, kind: 'NOT_APPLICABLE', note }).then((next) => next && setPanel(null))} /> : null}
      <RinseScreen
        name={bench.name}
        view={bench.view}
        running={running || busy}
        destination={choice}
        actions={{
          onAddFile: (input) =>
            void attempt(async () => {
              const path = await platform.chooseFile(`The file for: ${label(input)}`);
              if (path) setBench(await client.ask<BenchState>('set.addFile', { path, input }));
            }).then(() => rinse()),
          onEnterByHand: (_input, form) => setPanel({ kind: 'hand', form: form as HandEntryFormId }),
          onMarkNotApplicable: (input) => setPanel({ kind: 'note', input, label: label(input) }),
          onExclude: (fileId) => void benchCommand('set.exclude', { fileId }),
          onRerun: (fileId) => void benchCommand('set.rerun', { fileId }),
          onChooseDestination: (kind) => {
            setDestination(kind);
            setNotice(null);
          },
          onSignIn: (provider) =>
            void attempt(async () => {
              const started = await client.ask<{ url: string; cloud: CloudState[] }>('cloud.signIn', { provider });
              setCloud(started.cloud);
              await platform.openInBrowser(started.url);
            }),
          onSignOut: (provider) => void attempt(async () => setCloud((await client.ask<{ cloud: CloudState[] }>('cloud.signOut', { provider })).cloud)),
          onUpload: () =>
            void attempt(async () => {
              let next: BenchState;
              if (destination === 'FOLDER') {
                const parent = await platform.chooseFolder('Where to put the finished set');
                if (!parent) return;
                next = await client.ask<BenchState>('set.write', { parent });
              } else next = await client.ask<BenchState>('set.upload', { provider: destination });
              setBench(next);
              if (next.open && next.written) setNotice(`Done: ${next.written.written} files written to ${next.written.location}. Tell the deal team the set is ready; they connect that folder to the pact.`);
            }),
        }}
      />
      {cloudEntry && !cloudEntry.registered ? <p className="mx-auto max-w-4xl px-10 text-sm text-slate-500">{DESTINATION_LABELS[cloudEntry.provider]} is not registered for Pactlab Rinse yet. Write the set to a folder, then copy it to your drive.</p> : null}
      {cloudEntry?.failed ? <p className="mx-auto max-w-4xl px-10 text-sm text-rose-800">The {DESTINATION_LABELS[cloudEntry.provider]} sign-in did not complete. Try again.</p> : null}
      <div className="mx-auto max-w-4xl px-10">
        <Problem text={error} />
        {notice ? (
          <p role="status" className="mt-4 rounded-xl bg-teal-50 px-4 py-3 text-sm text-teal-900">
            {notice}
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
