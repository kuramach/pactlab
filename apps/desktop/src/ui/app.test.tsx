import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HandEntryPanel, NotePanel, SetUpScreen, SignInScreen, type SessionStatus } from './app';
import { messageFor, SidecarClient, SidecarFailure, type SidecarTransport } from './sidecar-client';
import { inviteToken } from './tauri';

/** A stand-in for the engine: answers each request line with whatever `answer` gives. */
function engine(answer: (request: { id: number; command: string }) => object): { transport: SidecarTransport; sent: string[] } {
  let listener: (line: string) => void = () => undefined;
  const sent: string[] = [];
  return {
    sent,
    transport: {
      onLine: (next) => (listener = next),
      write: async (line) => {
        sent.push(line);
        const request = JSON.parse(line) as { id: number; command: string };
        const reply = JSON.stringify({ id: request.id, ...answer(request) });
        // Replies may arrive split across chunks.
        queueMicrotask(() => {
          listener(reply.slice(0, 7));
          listener(`${reply.slice(7)}\n`);
        });
      },
    },
  };
}

const session: SessionStatus = { signedIn: true, email: 'dana@harbour.example', name: 'Dana Whitlow', organization: 'Harbour Lane Apartments LLC (synthetic)', bindings: [{ bindingId: '0195d1c2-0000-7000-8000-000000000001', organizationId: '0195d1c2-0000-7000-8000-000000000002', dealId: '0195d1c2-0000-7000-8000-000000000003', pactName: 'Project Harbour Lane', invitedBy: 'Rinse Buyers', boundAt: '2026-11-27T10:00:00.000Z' }], waiting: 0 };

describe('the Rinse window (T-178e)', () => {
  it('talks to the engine one JSON line per request, matching replies by id, and words failures itself', async () => {
    const { transport, sent } = engine((request) => (request.command === 'set.view' ? { ok: true, result: { open: false } } : { ok: false, code: 'NOT_READY' }));
    const client = new SidecarClient(transport);
    const [view, write] = await Promise.allSettled([client.ask('set.view'), client.ask('set.write', { parent: '/tmp' })]);
    expect(view).toEqual({ status: 'fulfilled', value: { open: false } });
    expect(write.status === 'rejected' && write.reason).toEqual(new SidecarFailure('NOT_READY'));
    expect(sent.map((line) => JSON.parse(line))).toEqual([{ id: 1, command: 'set.view' }, { id: 2, command: 'set.write', parent: '/tmp' }]);
    expect(sent.every((line) => line.endsWith('\n'))).toBe(true);
    expect(messageFor(new SidecarFailure('NOT_READY'))).toContain('not clean yet');
    expect(messageFor(new SidecarFailure('SOMETHING_NEW'))).toBe('That did not work. Nothing was lost; try again.');
    expect(messageFor(new Error('/Users/dana/secret path'))).not.toContain('/Users');
  });

  it('reads the token from a prep-invite deep link, the web link or the bare token', () => {
    const token = 'A'.repeat(43);
    expect(inviteToken(`pactlab-rinse://invite?token=${token}`)).toBe(token);
    expect(inviteToken(`https://pactlab.ai/rinse?invite=${token}#download`)).toBe(token);
    expect(inviteToken(` ${token} `)).toBe(token);
    expect(inviteToken('https://pactlab.ai/rinse')).toBeNull();
    expect(inviteToken('<script>')).toBeNull();
  });

  it('signs in from the invite with name and company, then a code', () => {
    const start = renderToStaticMarkup(<SignInScreen invite="" busy={false} error={null} codeSent={false} onSend={() => undefined} onVerify={() => undefined} />);
    expect(start).toContain('Sign in with your prep invite');
    for (const label of ['Invite link', 'Your email', 'Your name', 'Your company']) expect(start).toContain(label);
    expect(start).toContain('stamped on the set');
    const code = renderToStaticMarkup(<SignInScreen invite="x" busy={false} error="That invite link is not valid any more." codeSent onSend={() => undefined} onVerify={() => undefined} />);
    expect(code).toContain('Enter the code we emailed you');
    expect(code).toContain('role="alert"');
    expect(code).toMatch(/<button[^>]*disabled=""[^>]*>Sign in<\/button>/);
  });

  it('sets up a set for a bound pact, any released pack and a currency, before choosing the folder', () => {
    const html = renderToStaticMarkup(<SetUpScreen session={session} busy={false} error={null} onOpen={() => undefined} onSignOut={() => undefined} />);
    expect(html).toContain('Project Harbour Lane (invited by Rinse Buyers)');
    expect(html).toContain('Not for a pact yet');
    expect(html).toContain('Multifamily');
    expect(html).toContain('<option>JPY</option>');
    expect(html).toContain('Choose the folder');
    expect(html).toContain('Signed in as Dana Whitlow (Harbour Lane Apartments LLC (synthetic))');
  });

  it('enters a document by hand from the form’s own fields, marked as a claim, and notes a gap with a reason', () => {
    const html = renderToStaticMarkup(<HandEntryPanel form="VACANCY_SCHEDULE" problems={[{ row: 1, field: 'units', problem: 'NOT_A_COUNT' }]} busy={false} onSave={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('Vacancy and occupancy schedule');
    expect(html).toContain('Average in-place rent (optional)');
    expect(html).toContain('never as documentary evidence');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Add a row');
    expect(renderToStaticMarkup(<HandEntryPanel form="KEY_LEASE_TERMS" problems={[]} busy={false} onSave={() => undefined} onCancel={() => undefined} />)).not.toContain('Add a row');
    const note = renderToStaticMarkup(<NotePanel label="Unit inspection" busy={false} onSave={() => undefined} onCancel={() => undefined} />);
    expect(note).toContain('Unit inspection: not applicable');
    expect(note).toMatch(/<button[^>]*disabled=""[^>]*>Save the note<\/button>/);
  });
});
