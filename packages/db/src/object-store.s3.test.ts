import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3ObjectStore } from './object-store';

const KEY = '0190f000-0000-7000-8000-000000000001/0190f000-0000-7000-8000-000000000002/documents/file.pdf';

/** A stand-in for the S3 client: records each command, returns a body for reads. */
function fakeClient() {
  const sent: unknown[] = [];
  const client = {
    send: async (command: unknown) => {
      sent.push(command);
      if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      return {};
    },
  } as unknown as S3Client;
  return { client, sent };
}

describe('S3ObjectStore', () => {
  it('writes once, encrypted with the environment key, and records the hash', async () => {
    const { client, sent } = fakeClient();
    await new S3ObjectStore(client, 'evidence-bucket', 'key-arn').put(KEY, new Uint8Array([9]), { contentType: 'application/pdf', sha256: 'a'.repeat(64) });
    const put = sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: 'evidence-bucket', Key: KEY, IfNoneMatch: '*', ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'key-arn', ContentType: 'application/pdf', Metadata: { sha256: 'a'.repeat(64) } });
  });

  it('reads and deletes by key', async () => {
    const { client, sent } = fakeClient();
    const store = new S3ObjectStore(client, 'evidence-bucket', 'key-arn');
    expect(await store.get(KEY)).toEqual(new Uint8Array([1, 2, 3]));
    await store.delete(KEY);
    expect(sent[1]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('refuses keys without the tenant prefix, before any call', async () => {
    const { client, sent } = fakeClient();
    const store = new S3ObjectStore(client, 'evidence-bucket', 'key-arn');
    for (const key of ['file.pdf', 'not-a-uuid/also-not/file.pdf', `${KEY.split('/').slice(0, 2).join('/')}/../escape`]) {
      await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow(/tenant-prefixed/);
      await expect(store.get(key)).rejects.toThrow(/tenant-prefixed/);
    }
    expect(sent).toEqual([]);
  });
});
