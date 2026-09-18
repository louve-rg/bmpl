/**
 * Unit spec for the integration wrapper's build gate (BMPL-133). Every spawn
 * is a vi.fn() — no real build, no turbo, no pnpm runs here. What is pinned:
 *
 * - turbo stays the primary path and, when it succeeds, pnpm is never spawned;
 * - ANY unsuccessful turbo build (non-zero status, spawn-level error, or turbo
 *   not even resolvable) falls back to the pnpm build, and a pnpm success
 *   proceeds to the suite (exit is never called);
 * - both paths failing prints the one refusal, verbatim, and exits non-zero —
 *   the caller never reaches the vitest spawn because exit fires first;
 * - the fallback spawns pnpm's own JS entry through node when npm_execpath
 *   names pnpm (the documented `pnpm run` invocation), and only otherwise
 *   shells out to `pnpm` with all-literal arguments.
 */
import { describe, it, expect, vi } from 'vitest';
import { enforceWorkspaceBuild } from './run-integration.mjs';

const TURBO_BIN = 'X:/repo/node_modules/turbo/bin/turbo';
const NODE = 'X:/node/node.exe';
const PNPM_MJS = 'X:/pnpm/node_modules/pnpm/bin/pnpm.mjs';
const TURBO_ARGV = [TURBO_BIN, 'run', 'build', '--filter=./packages/*', '--output-logs=errors-only'];
const PNPM_ARGS = ['-r', '--filter=./packages/*', 'run', 'build'];
const REFUSAL =
  '[run-integration] refusing to run: workspace package build failed, and running the suite against stale dist proves nothing.';

function makeDeps(spawnImpl, overrides = {}) {
  return {
    spawn: vi.fn(spawnImpl),
    cwd: 'X:/repo',
    execPath: NODE,
    npmExecPath: PNPM_MJS,
    resolveTurboBin: () => TURBO_BIN,
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
    ...overrides,
  };
}

const isTurboCall = (argv) => argv[0] === TURBO_BIN;

describe('enforceWorkspaceBuild', () => {
  it('turbo success: builds via turbo only, never touches pnpm, never exits', () => {
    const deps = makeDeps(() => ({ status: 0 }));
    const result = enforceWorkspaceBuild(deps);

    expect(result).toEqual({ ok: true, via: 'turbo' });
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledWith(NODE, TURBO_ARGV, expect.objectContaining({ cwd: 'X:/repo' }));
    expect(deps.exit).not.toHaveBeenCalled();
    expect(deps.error).not.toHaveBeenCalled();
  });

  it('turbo non-zero, pnpm success: announces the fallback and proceeds (the Application Control shape — a plain status, no spawn error)', () => {
    const deps = makeDeps((cmd, argv) => (isTurboCall(argv) ? { status: 1 } : { status: 0 }));
    const result = enforceWorkspaceBuild(deps);

    expect(result).toEqual({ ok: true, via: 'pnpm' });
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    // npm_execpath names pnpm's JS entry -> spawned through node, no shell.
    expect(deps.spawn).toHaveBeenLastCalledWith(NODE, [PNPM_MJS, ...PNPM_ARGS], expect.objectContaining({ cwd: 'X:/repo' }));
    // A pnpm success means the run continues to the suite: no exit, no refusal.
    expect(deps.exit).not.toHaveBeenCalled();
    expect(deps.error).not.toHaveBeenCalled();
    const announcement = deps.log.mock.calls.map((c) => c[0]).join('\n');
    expect(announcement).toContain('TURBO BUILD FAILED OR COULD NOT RUN');
    expect(announcement).toContain('pnpm -r --filter=./packages/* run build');
  });

  it('turbo spawn-level error (status null + error field) still falls back', () => {
    const deps = makeDeps((cmd, argv) =>
      isTurboCall(argv) ? { status: null, error: new Error('spawn UNKNOWN') } : { status: 0 },
    );
    const result = enforceWorkspaceBuild(deps);

    expect(result).toEqual({ ok: true, via: 'pnpm' });
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('turbo unresolvable (resolve throws) still falls back — turbo itself is never spawned', () => {
    const deps = makeDeps(() => ({ status: 0 }), {
      resolveTurboBin: () => {
        throw new Error("Cannot find module 'turbo/bin/turbo'");
      },
    });
    const result = enforceWorkspaceBuild(deps);

    expect(result).toEqual({ ok: true, via: 'pnpm' });
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn.mock.calls[0][1][0]).not.toBe(TURBO_BIN);
  });

  it('BOTH paths failing refuses with the exact message and a non-zero exit, before any test could run', () => {
    const deps = makeDeps((cmd, argv) => (isTurboCall(argv) ? { status: 3 } : { status: 7 }));
    const result = enforceWorkspaceBuild(deps);

    expect(result.ok).toBe(false);
    expect(deps.error).toHaveBeenCalledWith(REFUSAL);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(7);
  });

  it('both failing without a status (two spawn-level errors) still exits non-zero, never zero', () => {
    const deps = makeDeps(() => ({ status: null, error: new Error('spawn UNKNOWN') }));
    const result = enforceWorkspaceBuild(deps);

    expect(result.ok).toBe(false);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('without a pnpm npm_execpath, the fallback shells out to `pnpm` with all-literal arguments', () => {
    const deps = makeDeps((cmd, argv) => (isTurboCall(argv) ? { status: 1 } : { status: 0 }), {
      npmExecPath: undefined,
    });
    enforceWorkspaceBuild(deps);

    expect(deps.spawn).toHaveBeenLastCalledWith('pnpm', PNPM_ARGS, expect.objectContaining({ shell: true, cwd: 'X:/repo' }));
  });

  it('an npm_execpath that is not pnpm (e.g. npm-cli.js) is not trusted as the pnpm entry', () => {
    const deps = makeDeps((cmd, argv) => (isTurboCall(argv) ? { status: 1 } : { status: 0 }), {
      npmExecPath: 'X:/npm/bin/npm-cli.js',
    });
    enforceWorkspaceBuild(deps);

    expect(deps.spawn).toHaveBeenLastCalledWith('pnpm', PNPM_ARGS, expect.objectContaining({ shell: true }));
  });
});
