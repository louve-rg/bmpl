// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeView } from '../../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// MDF-316: role-contextual nav must remain a presentation mechanism, never a
// change to authorization. roles-switch-boundary.integration.spec.ts proves the
// SERVER grants/revokes correctly; nothing anywhere exercised the switcher
// control itself. Written against current main, authorized as a regression net
// ahead of the Liquid Glass redesign (stage 2 rewrites this component's
// markup) — so this asserts only behaviour the redesign must preserve, never
// markup: not a class name, a DOM structure, or a style, anywhere below.
const apiPost = vi.fn();
const refresh = vi.fn();
vi.mock('../../lib/api', () => ({ api: { post: (...a: unknown[]) => apiPost(...a) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { RoleSwitcher } from './RoleSwitcher';

// Same convention as AvailabilityWindows.test.tsx: a plain `select.value = x`
// goes through React's own instance-level setter and looks like a no-op to its
// value-tracker, swallowing the follow-up event. Calling the prototype's
// native setter directly bypasses that tracker so onChange actually fires.
const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
function chooseRole(select: HTMLSelectElement, value: string) {
  act(() => {
    nativeSelectValueSetter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function meWith(roles: MeView['roles'], activeRole: MeView['activeRole']): MeView {
  return { roles, activeRole } as unknown as MeView;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(me: MeView) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<RoleSwitcher me={me} />));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  apiPost.mockReset();
  refresh.mockReset();
});

describe('RoleSwitcher — behaviour the redesign must preserve', () => {
  it('offers exactly the roles the user holds as selectable, and no role that is not', () => {
    const el = render(
      meWith(
        [
          { roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true },
          { roleCode: 'VENDOR', label: 'Vendor', status: 'APPROVED', isSelectable: true },
          { roleCode: 'DELIVERY_DRIVER', label: 'Delivery driver', status: 'PENDING', isSelectable: false },
        ],
        'CUSTOMER',
      ),
    );

    const options = Array.from(el.querySelectorAll('select option')).map((o) => (o as HTMLOptionElement).value);

    expect(options.sort()).toEqual(['CUSTOMER', 'VENDOR']);
    expect(options).not.toContain('DELIVERY_DRIVER');
  });

  it('choosing a different held role actually switches the active role, through the server', async () => {
    const el = render(
      meWith(
        [
          { roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true },
          { roleCode: 'VENDOR', label: 'Vendor', status: 'APPROVED', isSelectable: true },
        ],
        'CUSTOMER',
      ),
    );
    apiPost.mockResolvedValue({});

    const select = el.querySelector('select') as HTMLSelectElement;
    chooseRole(select, 'VENDOR');
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledWith('/roles/switch', { roleCode: 'VENDOR' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
