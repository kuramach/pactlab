import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { SecretUnavailableError } from '@pactlab/connectors';
import { describe, expect, it } from 'vitest';
import { SecretsManagerSecretStore } from './secrets-manager-store';

/** Secrets Manager's behaviour for the four calls the store makes, in memory. */
function fakeSecretsManager() {
  const secrets = new Map<string, { value: string; kmsKeyId?: string }>();
  const notFound = () => new ResourceNotFoundException({ message: 'not found', $metadata: {} });
  const sent: string[] = [];
  const client = {
    send: async (command: unknown) => {
      if (command instanceof PutSecretValueCommand) {
        sent.push(`put ${command.input.SecretId}`);
        const found = secrets.get(command.input.SecretId as string);
        if (!found) throw notFound();
        found.value = command.input.SecretString as string;
        return {};
      }
      if (command instanceof CreateSecretCommand) {
        sent.push(`create ${command.input.Name}`);
        secrets.set(command.input.Name as string, { value: command.input.SecretString as string, kmsKeyId: command.input.KmsKeyId as string });
        return {};
      }
      if (command instanceof GetSecretValueCommand) {
        const found = secrets.get(command.input.SecretId as string);
        if (!found) throw notFound();
        return { SecretString: found.value };
      }
      if (command instanceof DeleteSecretCommand) {
        sent.push(`delete ${command.input.SecretId} force=${String(command.input.ForceDeleteWithoutRecovery)}`);
        if (!secrets.delete(command.input.SecretId as string)) throw notFound();
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  return { client: client as never, secrets, sent };
}

describe('the deployed credential store (Secrets Manager)', () => {
  it('keeps each credential under the environment prefix, encrypted with its key; reads, overwrites and deletes it', async () => {
    const fake = fakeSecretsManager();
    const store = new SecretsManagerSecretStore(fake.client, 'pactlab/prod/credentials', 'key-arn');
    await store.put('secretref:org-1/google-drive/c-1', '{"accessToken":"a"}');
    expect(fake.secrets.get('pactlab/prod/credentials/org-1/google-drive/c-1')).toEqual({ value: '{"accessToken":"a"}', kmsKeyId: 'key-arn' });
    await store.put('secretref:org-1/google-drive/c-1', '{"accessToken":"b"}');
    expect(await store.get('secretref:org-1/google-drive/c-1')).toBe('{"accessToken":"b"}');
    // References written before (secretref:pactlab/…) land under the same prefix, not a doubled one.
    await store.put('secretref:pactlab/org-1/deal-1/document-source/s-1', 'token');
    expect(fake.secrets.has('pactlab/prod/credentials/org-1/deal-1/document-source/s-1')).toBe(true);
    await store.delete('secretref:org-1/google-drive/c-1');
    expect(fake.sent).toContain('delete pactlab/prod/credentials/org-1/google-drive/c-1 force=true');
    await expect(store.get('secretref:org-1/google-drive/c-1')).rejects.toBeInstanceOf(SecretUnavailableError);
    await expect(store.delete('secretref:org-1/google-drive/c-1')).resolves.toBeUndefined();
  });

  it('refuses anything that is not a secret reference', async () => {
    const store = new SecretsManagerSecretStore(fakeSecretsManager().client, 'pactlab/prod/credentials', 'key');
    await expect(store.put('../../other', 'x')).rejects.toBeInstanceOf(SecretUnavailableError);
  });
});
