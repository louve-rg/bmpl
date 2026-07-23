'use client';

import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      router.push('/login');
      router.refresh();
    }
  }
  return (
    <button
      onClick={logout}
      className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-belize-navy"
    >
      Sign out
    </button>
  );
}
