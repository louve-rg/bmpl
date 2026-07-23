import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Server-side validation for every request body/query. Rule #9: forms use
 * server-side validation. Client-side checks are convenience only.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}

/** Factory for use in @Body(new ZodBody(schema)). */
export const ZodBody = (schema: ZodSchema) => new ZodValidationPipe(schema);
