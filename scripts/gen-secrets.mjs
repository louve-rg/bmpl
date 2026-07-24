/**
 * Generates the strong secrets needed for a cloud environment. Run LOCALLY by
 * the operator; paste the output into the provider's secret manager (Railway).
 * Nothing is written to disk or committed.
 *
 *   node scripts/gen-secrets.mjs
 */
import { randomBytes } from 'node:crypto';

const s = (n = 48) => randomBytes(n).toString('base64url');

// A strong temporary bootstrap password (≥12, letter+number+symbol).
const symbols = '!@#$%^&*-_=+';
function bootstrapPassword() {
  const base = randomBytes(18).toString('base64url').slice(0, 20);
  const sym = symbols[randomBytes(1)[0] % symbols.length];
  return `${base}${sym}9`;
}

console.log(`# --- Paste into Railway API service variables (SECRET) ---
JWT_ACCESS_SECRET=${s()}
JWT_REFRESH_SECRET=${s()}
COOKIE_SECRET=${s()}

# --- One-time cloud admin bootstrap (remove/rotate after first login) ---
BOOTSTRAP_ADMIN_EMAIL=ops@bzemarketplace.com
BOOTSTRAP_ADMIN_PASSWORD=${bootstrapPassword()}
`);
