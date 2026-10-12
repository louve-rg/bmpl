'use client';

import { useEffect } from 'react';

/**
 * MDF-126: the shared owner of `document.body.style.overflow`.
 *
 * Three surfaces lock background scroll while open: the mobile/account nav
 * menu (`useModalMenu`), `FullScreenMapModal`, and `EnlargeableImage`'s
 * lightbox — and a page can have several of the latter two mounted at once
 * (a product gallery, a map next to photos). Each used to snapshot
 * `document.body.style.overflow` on its own open and restore its own
 * snapshot on its own close. That makes correctness depend on close ORDER:
 * if the first dialog opened is also the first one closed, its restore
 * fires while a second dialog is still open and still covering the page —
 * unlocking the background too early — and the second dialog's closedown
 * then re-applies the first dialog's stale "hidden" snapshot, which nothing
 * ever undoes. Reversing the close order happened to self-correct, which is
 * exactly why this stayed latent: it looked fine from the one angle anyone
 * tried it from.
 *
 * The fix is a reference count, not a smarter snapshot. The ORIGINAL value
 * is captured once, on the 0 -> 1 transition, and restored once, on the
 * N -> 0 transition. Every caller below is interchangeable and close order
 * is irrelevant, because there is exactly one snapshot for the whole page,
 * not one per caller.
 */
let lockCount = 0;
let originalOverflow = '';

function acquire(): void {
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function release(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow;
  }
}

/** Call with `true` while a dialog, drawer or menu is open; `false` (or unmount) releases it. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
}
