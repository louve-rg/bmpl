'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';
import { Avatar } from '../Avatar';

export type AccountMenuTone = 'dark' | 'light';

/**
 * The one account menu for a signed-in person (P5 of the nav plan).
 *
 * It replaces the split that had grown up: the public header showed an avatar
 * link and a sign-out button, the desktop sidebar showed a profile link and a
 * sign-out button, and the phone drawer repeated the sidebar. All three now
 * render this, so the account actions and the sign-out call exist once.
 *
 * It is a disclosure, not a dialog: the panel is a list of links and one
 * button. Escape closes it and returns focus to the trigger; a click or tap
 * outside closes it. It does not lock scroll or trap Tab, because nothing
 * here is modal. It deliberately does NOT close on focus leaving: Safari does
 * not focus a button on click, so that would close the panel before its own
 * Sign out click lands.
 *
 * Sign-out is UX only. The server still decides every request; this only
 * clears the session cookie and moves the person to a signed-out page.
 */
export function AccountMenu({
  me,
  tone,
  afterSignOut = '/login',
  onSignedOut,
  onNavigate,
}: {
  me: MeView;
  tone: AccountMenuTone;
  /** Where to send the person after sign-out. The public header uses '/'. */
  afterSignOut?: string;
  /** Lets a host clear its own state (the header drops `me`). */
  onSignedOut?: () => void;
  /** Lets a host close itself on navigation (the phone drawer). */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The header renders two of these (desktop row and mobile list), so the id
  // must be unique per instance, not per tone.
  const panelId = `account-menu-${useId()}`;
  const dark = tone === 'dark';

  // Outside click or tap closes the panel.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent | TouchEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  // Escape closes and puts focus back on the trigger, so a keyboard user is not
  // left inside a panel that has disappeared.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    onNavigate?.();
  }

  async function signOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* clear local state regardless, as every sign-out path here always has */
    }
    setOpen(false);
    onSignedOut?.();
    router.push(afterSignOut);
    router.refresh();
  }

  const itemClass = dark
    ? 'block rounded px-3 py-2 text-sm text-blue-100 hover:bg-white/5 hover:text-white'
    : 'block rounded-bmpl-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-belize-navy';

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={
          dark
            ? 'flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium text-white transition hover:bg-white/10'
            : 'flex w-full items-center gap-3 rounded-bmpl-md px-3 py-1.5 text-left transition hover:bg-slate-50'
        }
      >
        <Avatar name={`${me.firstName} ${me.lastName}`} src={me.avatarUrl} size={dark ? 'sm' : 'md'} />
        <span className="min-w-0">
          <span className={`block truncate ${dark ? 'max-w-[10rem]' : ''} text-sm font-semibold ${dark ? 'text-white' : 'text-belize-navy'}`}>
            {me.firstName} {me.lastName}
          </span>
          {!dark && <span className="block truncate text-xs text-slate-500">{me.email}</span>}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className={
            dark
              ? 'absolute right-0 z-50 mt-2 w-56 rounded-bmpl-md border border-white/10 bg-belize-navy p-2 shadow-bmpl-md'
              : 'mt-2 rounded-bmpl-md border border-slate-100 bg-slate-50 p-2'
          }
        >
          <Link href="/dashboard" onClick={close} className={itemClass}>
            Dashboard
          </Link>
          <Link href="/dashboard/profile" onClick={close} className={itemClass}>
            Profile
          </Link>
          <Link href="/orders" onClick={close} className={itemClass}>
            My orders
          </Link>
          <button type="button" onClick={signOut} className={`${itemClass} w-full text-left`}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
