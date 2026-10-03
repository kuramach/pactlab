import { uuidv7 } from 'uuidv7';

declare const brand: unique symbol;
export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type DealId = Brand<string, 'DealId'>;
export type UserId = Brand<string, 'UserId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All primary keys are UUIDv7 (time-ordered). */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
