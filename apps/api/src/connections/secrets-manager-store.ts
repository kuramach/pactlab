import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { isSecretRef, SecretUnavailableError, type SecretStore } from '@pactlab/connectors';

/**
 * Deployed environments' credential store (T-007, needed by T-147): AWS Secrets Manager, one secret per
 * reference under the environment's own prefix (`pactlab/<env>/credentials/…`), encrypted with the
 * environment's data key. The API's role may only touch that prefix. Values never leave the store except
 * to the adapter that uses them; they are never logged, returned or audited.
 */
export class SecretsManagerSecretStore implements SecretStore {
  constructor(
    private readonly client: Pick<SecretsManagerClient, 'send'>,
    /** e.g. `pactlab/prod/credentials` */
    private readonly prefix: string,
    private readonly kmsKeyId: string,
  ) {}

  /** `secretref:<org>/google-drive/<id>` → `<prefix>/<org>/google-drive/<id>`. */
  private nameOf(ref: string): string {
    if (!isSecretRef(ref)) throw new SecretUnavailableError('Not a secret reference');
    return `${this.prefix}/${ref.slice('secretref:'.length).replace(/^pactlab\//, '')}`;
  }

  async put(ref: string, value: string): Promise<void> {
    const name = this.nameOf(ref);
    try {
      await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
      return;
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw new SecretUnavailableError();
    }
    try {
      await this.client.send(new CreateSecretCommand({ Name: name, SecretString: value, KmsKeyId: this.kmsKeyId, Description: 'Pactlab connection credential' }));
    } catch (error) {
      // Created by a concurrent put a moment ago: write this value over it.
      if (!(error instanceof ResourceExistsException)) throw new SecretUnavailableError();
      await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
    }
  }

  async get(ref: string): Promise<string> {
    try {
      const result = await this.client.send(new GetSecretValueCommand({ SecretId: this.nameOf(ref) }));
      if (typeof result.SecretString !== 'string') throw new SecretUnavailableError('Secret not found');
      return result.SecretString;
    } catch (error) {
      if (error instanceof SecretUnavailableError) throw error;
      throw new SecretUnavailableError(error instanceof ResourceNotFoundException ? 'Secret not found' : undefined);
    }
  }

  /** A disconnect: gone at once, with no recovery window (nothing about the credential is kept). */
  async delete(ref: string): Promise<void> {
    try {
      await this.client.send(new DeleteSecretCommand({ SecretId: this.nameOf(ref), ForceDeleteWithoutRecovery: true }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw new SecretUnavailableError();
    }
  }
}
