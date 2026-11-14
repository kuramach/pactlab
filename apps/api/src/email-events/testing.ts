import { createSign, generateKeyPairSync } from 'node:crypto';
import { stringToSign, type SnsMessage } from './sns';

/** Tests only (T-109): an SNS signer with its own key, standing in for Amazon's certificate. */
export const TEST_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:pactlab-dev-mail-events';
export const TEST_CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const TEST_SIGNING_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

export function signedSns(fields: Partial<SnsMessage> & Pick<SnsMessage, 'Type' | 'Message'>, version: '1' | '2' = '2'): SnsMessage {
  const message = { MessageId: 'm-1', TopicArn: TEST_TOPIC_ARN, Timestamp: '2026-11-14T05:00:00.000Z', SignatureVersion: version, SigningCertURL: TEST_CERT_URL, Signature: '', ...fields } as SnsMessage;
  const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
  signer.update(stringToSign(message), 'utf8');
  return { ...message, Signature: signer.sign(privateKey, 'base64') };
}
