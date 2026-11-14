import { isUuid, objectKeyBelongsTo } from '@pactlab/domain';
import type { DocumentObjectStore } from './documents.repository';

/** Object store double that enforces the tenant key shape like the real stores do: `<organization id>/<id>/…`. */
export class InMemoryObjectStore implements DocumentObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array) {
    const [organizationId = '', dealId = ''] = key.split('/');
    if (!isUuid(organizationId) || !isUuid(dealId) || !objectKeyBelongsTo(key, organizationId, dealId) || key.split('/').length < 3) {
      throw new Error('Object keys must be tenant-prefixed');
    }
    this.objects.set(key, bytes);
  }

  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error('No such object');
    return bytes;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
