import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validate request input with the shared contract schemas. */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<unknown, z.infer<TSchema>> {
  /** Public so the API reference (T-128) is generated from the very schemas that validate. */
  constructor(readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) throw new BadRequestException('Request validation failed');
    return result.data;
  }
}
