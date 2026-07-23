import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export interface AccessTokenClaims extends JWTPayload {
  sub: string; // user id
  sid: string; // session id
  activeRole: string | null;
  client: string; // web | admin | mobile
}

const encoder = new TextEncoder();

export async function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'nbf'>,
  secret: string,
  ttl: string,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('bmpl')
    .setAudience('bmpl-api')
    .setExpirationTime(ttl)
    .sign(encoder.encode(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, encoder.encode(secret), {
    issuer: 'bmpl',
    audience: 'bmpl-api',
  });
  return payload as AccessTokenClaims;
}

/** Parse a duration string like "15m", "30d", "12h", "45s" into milliseconds. */
export function parseTtlMs(ttl: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(ttl.trim());
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2] as string;
  const table: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const factor = table[unit];
  if (factor === undefined) throw new Error(`Invalid TTL unit: ${ttl}`);
  return value * factor;
}
