import { objectKeyBelongsTo } from '@pactlab/domain';
import type { DocumentObjectStore } from './documents.repository';

/** Object store double that enforces the tenant key prefix like the bucket policy does. */
export class InMemoryObjectStore implements DocumentObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array) {
    const [organizationId = '', dealId = ''] = key.split('/');
    if (!objectKeyBelongsTo(key, organizationId, dealId) || key.split('/').length < 3) {
      throw new Error('Object keys must be tenant-prefixed');
    }
    this.objects.set(key, bytes);
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
