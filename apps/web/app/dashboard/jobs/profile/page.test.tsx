// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Skills, Education and Certifications are what the person says about themselves.
// BML does not verify them, so the page must say so next to each one. This pins
// that wording, so a certificate typed here cannot render like a checked one.
const getProfile = vi.fn();
vi.mock('../../../../lib/jobs', () => ({ jobsApi: { getProfile: () => getProfile() } }));

import JobSeekerProfilePage from './page';

const EMPTY_PROFILE = {
  id: 'p1',
  headline: null,
  summary: null,
  visibility: 'PRIVATE',
  skills: [],
  education: [],
  certifications: [],
  experience: [],
  languages: [],
  resumes: [],
} as unknown as Record<string, unknown>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  getProfile.mockReset();
  root = null;
  container = null;
});

async function render() {
  getProfile.mockResolvedValue(EMPTY_PROFILE);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<JobSeekerProfilePage />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container.textContent ?? '';
}

describe('job profile: self-reported sections are labelled as such', () => {
  it('says Skills, Education and Certifications are entered by the person and not checked by BML', async () => {
    const text = await render();
    expect(text).toContain('Skills');
    expect(text).toContain('Education');
    expect(text).toContain('Certifications');
    expect(text.split('Entered by you. BML does not check this').length - 1).toBe(2);
    expect(text).toContain('Entered by you. BML does not check certificates, so listing one here is what you say');
  });

  it('does not describe any certificate as verified or endorsed', async () => {
    const text = await render();
    expect(text.toLowerCase()).not.toContain('verified');
    expect(text.toLowerCase()).not.toContain('endorse');
  });
});
