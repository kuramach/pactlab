import { describe, expect, it } from 'vitest';
import { bareAddress, parseSesEvent } from './ses-event';

const mail = { messageId: 'ses-1', timestamp: '2026-11-14T05:00:00.000Z', destination: ['Lead <bounce@simulator.amazonses.com>'] };

describe('SES events (T-109)', () => {
  it('reads a permanent bounce per recipient, without the address in the diagnostic', () => {
    const events = parseSesEvent(
      JSON.stringify({
        eventType: 'Bounce',
        mail,
        bounce: { bounceType: 'Permanent', bounceSubType: 'General', timestamp: '2026-11-14T05:00:01.000Z', bouncedRecipients: [{ emailAddress: 'bounce@simulator.amazonses.com', diagnosticCode: 'smtp; 550 5.1.1 user unknown <bounce@simulator.amazonses.com>' }] },
      }),
    );
    expect(events).toEqual([
      { type: 'BOUNCE', address: 'bounce@simulator.amazonses.com', sesMessageId: 'ses-1', bounceType: 'Permanent', bounceSubtype: 'General', diagnostic: 'smtp; 550 5.1.1 user unknown <<address>>', occurredAt: new Date('2026-11-14T05:00:01.000Z') },
    ]);
  });

  it('reads complaints, deliveries, rejects and rendering failures', () => {
    expect(parseSesEvent(JSON.stringify({ eventType: 'Complaint', mail, complaint: { complainedRecipients: [{ emailAddress: 'complaint@simulator.amazonses.com' }], complaintFeedbackType: 'abuse' } }))?.[0]).toMatchObject({ type: 'COMPLAINT', diagnostic: 'feedback: abuse' });
    expect(parseSesEvent(JSON.stringify({ eventType: 'Delivery', mail, delivery: { recipients: ['success@simulator.amazonses.com'] } }))?.[0]).toMatchObject({ type: 'DELIVERY', address: 'success@simulator.amazonses.com' });
    expect(parseSesEvent(JSON.stringify({ eventType: 'Reject', mail, reject: { reason: 'Bad content' } }))?.[0]).toMatchObject({ type: 'REJECT' });
    expect(parseSesEvent(JSON.stringify({ eventType: 'Rendering Failure', mail, failure: { errorMessage: 'x' } }))?.[0]).toMatchObject({ type: 'RENDERING_FAILURE' });
    expect(parseSesEvent(JSON.stringify({ eventType: 'Open', mail }))).toBeNull();
    expect(parseSesEvent('nope')).toBeNull();
  });

  it('takes the bare address out of a display form', () => {
    expect(bareAddress('Lead <Lead@Example.com>')).toBe('lead@example.com');
    expect(bareAddress('not an address')).toBeNull();
  });
});
