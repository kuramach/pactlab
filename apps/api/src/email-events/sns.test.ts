import { describe, expect, it } from 'vitest';
import { isSnsUrl, SnsVerificationError, SnsVerifier } from './sns';
import { signedSns, TEST_CERT_URL as CERT_URL, TEST_SIGNING_PEM as PEM, TEST_TOPIC_ARN as TOPIC } from './testing';

describe('SNS message verification (T-109)', () => {
  const fetched: string[] = [];
  const verifier = new SnsVerifier(TOPIC, async (url) => {
    fetched.push(url.toString());
    return PEM;
  });

  it('accepts a correctly signed notification (signature versions 1 and 2), with or without a subject', async () => {
    await expect(verifier.verify(JSON.stringify(signedSns({ Type: 'Notification', Message: '{"a":1}' })))).resolves.toMatchObject({ Type: 'Notification' });
    await expect(verifier.verify(signedSns({ Type: 'Notification', Message: 'x', Subject: 'Amazon SES Email Event Notification' }, '1'))).resolves.toBeTruthy();
    // The certificate is fetched once per URL.
    expect(fetched).toEqual([CERT_URL]);
  });

  it('refuses a changed message, another topic, a certificate from elsewhere, and garbage', async () => {
    const good = signedSns({ Type: 'Notification', Message: '{"eventType":"Delivery"}' });
    const reason = (body: unknown) => verifier.verify(body).then(() => 'accepted', (error: unknown) => (error instanceof SnsVerificationError ? error.reason : 'other'));
    expect(await reason({ ...good, Message: '{"eventType":"Bounce"}' })).toBe('SIGNATURE');
    expect(await reason({ ...good, TopicArn: 'arn:aws:sns:us-east-1:123456789012:other' })).toBe('WRONG_TOPIC');
    for (const url of ['http://sns.us-east-1.amazonaws.com/SimpleNotificationService-a.pem', 'https://sns.us-east-1.amazonaws.com.evil.example/SimpleNotificationService-a.pem', 'https://evil.example/SimpleNotificationService-a.pem', 'https://sns.us-east-1.amazonaws.com/other.pem']) {
      expect(await reason({ ...good, SigningCertURL: url }), url).toBe('CERT_URL');
    }
    expect(await reason('not json')).toBe('MALFORMED');
    expect(await reason({ Type: 'Notification' })).toBe('MALFORMED');
    expect(await reason({ ...signedSns({ Type: 'SubscriptionConfirmation', Message: 'confirm' }) })).toBe('MALFORMED');
  });

  it('recognises SNS links only on SNS hosts over https', () => {
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=t', /^\/$/)).toBe(true);
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com:8443/', /^\/$/)).toBe(false);
    expect(isSnsUrl('https://user@sns.eu-west-1.amazonaws.com/', /^\/$/)).toBe(false);
    expect(isSnsUrl('https://169.254.169.254/', /^\/$/)).toBe(false);
  });
});
