import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { registerSchema, loginSchema } from '@bmpl/validation';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe (server-side validation)', () => {
  it('passes a valid registration payload through', () => {
    const pipe = new ZodValidationPipe(registerSchema);
    const value = pipe.transform({
      email: 'Test@Example.BZ',
      password: 'strongpass1',
      firstName: 'Ana',
      lastName: 'Lopez',
      acceptedTerms: true,
    }) as { email: string };
    expect(value.email).toBe('test@example.bz'); // normalized
  });

  it('rejects a weak password with a field error', () => {
    const pipe = new ZodValidationPipe(registerSchema);
    expect(() =>
      pipe.transform({
        email: 'a@b.bz',
        password: 'short',
        firstName: 'A',
        lastName: 'B',
        acceptedTerms: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects login without a password', () => {
    const pipe = new ZodValidationPipe(loginSchema);
    expect(() => pipe.transform({ email: 'a@b.bz' })).toThrow(BadRequestException);
  });
});
