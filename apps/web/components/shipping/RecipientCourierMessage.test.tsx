// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipientCourierMessage } from './RecipientCourierMessage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const incomingCourierConversation = vi.fn();
vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      incomingCourierConversation: (...args: unknown[]) => incomingCourierConversation(...args),
    },
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  incomingCourierConversation.mockReset();
});

async function render(reference: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RecipientCourierMessage reference={reference} />);
  });
}

describe('RecipientCourierMessage', () => {
  it('links to the open courier conversation when one exists', async () => {
    incomingCourierConversation.mockResolvedValue({ conversationId: 'conv-123' });
    await render('BML-1');
    const link = container!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/dashboard/messages?c=conv-123');
    expect(link?.textContent).toBe('Message your courier');
    expect(incomingCourierConversation).toHaveBeenCalledWith('BML-1');
  });

  it('renders nothing when no conversation is open yet', async () => {
    incomingCourierConversation.mockResolvedValue({ conversationId: null });
    await render('BML-1');
    expect(container!.innerHTML).toBe('');
  });

  it('renders nothing when the lookup fails', async () => {
    incomingCourierConversation.mockRejectedValue(new Error('nope'));
    await render('BML-1');
    expect(container!.innerHTML).toBe('');
  });
});
