#!/usr/bin/env node
/**
 * infra-down-guard — a confirmation gate in front of `docker compose down`
 * (BMPL-297).
 *
 * Postgres/Redis/MinIO on this host are shared ON PURPOSE across every BMPL
 * worktree — `container_name` in docker-compose.yml is fixed, not
 * project-namespaced, so there is exactly one of each, and every worktree's
 * `.env` points at it. That sharing is deliberate (bmpl-api reads platform
 * settings from it as a source of truth, and makes audited admin changes
 * meant to be dev-wide), not an accident nobody noticed — see
 * docs/PROJECT_STATUS.md and CLAUDE.md for why. `docker compose down` run
 * from ANY worktree stops all three for EVERY worktree at once, and whoever
 * else is mid-test sees failing tests, not an outage — a wrong result, not a
 * loud one. This script does not stop that (a raw `docker rm`/`docker
 * compose down` outside this script still works), it only puts a check in
 * front of the one sanctioned entry point (`pnpm infra:down`).
 *
 * TWO DIFFERENT OPERATORS, TWO DIFFERENT GATES. The floor's actual operators
 * are agents running commands non-interactively — a confirmation prompt that
 * blocks on stdin is not a safety check for them, it is a hang: nothing is
 * there to answer it, and whatever called this will stall until some outer
 * timeout kills it with no indication why. So:
 *   - a real TTY on stdin (a person at a terminal): prompt, require the
 *     literal word "stop", anything else (including empty input) aborts.
 *   - no TTY (an agent, a script, a pipe): NEVER prompt — fail fast with a
 *     message naming the override (`--yes`), exit non-zero, and do not touch
 *     Docker at all. A refusal that returns immediately can be seen and
 *     acted on; a prompt nobody can answer cannot.
 *   - `--yes` (either path): skip the prompt and proceed immediately. This
 *     is the one thing that works the same for a human and an agent — an
 *     explicit, deliberate flag rather than an implicit wait.
 */
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const skipConfirm = process.argv.includes('--yes');

const WARNING = `
This stops the SHARED Postgres/Redis/MinIO used by every BMPL worktree on
this host, not just this one. Anyone else currently running tests or a dev
server against them will see failures, not an outage message.
`;

function runDown() {
  execFileSync('docker', ['compose', 'down'], { stdio: 'inherit' });
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function promptConfirm() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('Type "stop" to continue: ', resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'stop';
}

async function main() {
  console.log(WARNING);

  if (skipConfirm) {
    console.log('--yes given, skipping confirmation.');
    runDown();
    return;
  }

  if (!process.stdin.isTTY) {
    fail(
      'No terminal attached (this is being run non-interactively), so this will not prompt and wait on ' +
        "input nobody can provide. Pass --yes if you deliberately mean to stop this host's shared dev " +
        'infrastructure: pnpm infra:down -- --yes',
    );
    return;
  }

  const confirmed = await promptConfirm();
  if (!confirmed) {
    console.log('Not confirmed — leaving the shared containers running.');
    return;
  }
  runDown();
}

main();
