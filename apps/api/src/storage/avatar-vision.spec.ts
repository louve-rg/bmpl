import { describe, expect, it } from 'vitest';
import { AVATAR_POLICY } from '@bmpl/shared';
import { AvatarVisionService } from './avatar-vision.service';
import type { Env } from '../config/env';

/**
 * These exercise `judge` — the pure policy step that turns a provider's findings
 * into APPROVE / REJECT / REVIEW. The HTTP call to the provider is not under test;
 * the decision rules are, because they are what a real person's photo is measured
 * against.
 */
const service = (env: Partial<Env> = {}) =>
  new AvatarVisionService({ AVATAR_VISION_PROVIDER: 'none', ...env } as Env);

/** A 400×400 PNG header — enough for readImageSize, which is all judge() reads. */
const image = (width = 400, height = 400): Buffer => {
  const b = Buffer.alloc(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};

/** A detected face: confidence 0–1 (Google's scale) covering a square box. */
const face = (confidence: number, box = 200) => ({
  detectionConfidence: confidence,
  fdBoundingPoly: {
    vertices: [{ x: 0, y: 0 }, { x: box, y: 0 }, { x: box, y: box }, { x: 0, y: box }],
  },
});

const SAFE = { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'UNLIKELY' };

describe('AvatarVisionService.judge', () => {
  it('approves one confidently detected face that fills enough of the frame', () => {
    const verdict = service().judge(image(), [face(0.98)], SAFE);
    expect(verdict).toEqual({ decision: 'APPROVE', faceScore: 98 });
  });

  it('rejects an image with no face — the logo/product/landscape case', () => {
    const verdict = service().judge(image(), [], SAFE);
    expect(verdict).toMatchObject({ decision: 'REJECT', reason: 'NO_FACE' });
  });

  it('rejects a face detected too weakly to be a face at all', () => {
    const verdict = service().judge(image(), [face(0.2)], SAFE);
    expect(verdict).toMatchObject({ decision: 'REJECT', reason: 'NO_FACE' });
  });

  it('sends a middling detection to a human instead of rejecting it', () => {
    // Between reviewFaceConfidence and minFaceConfidence: a real person in profile
    // or bad light must not be told their own face is not a face.
    const between = (AVATAR_POLICY.reviewFaceConfidence + AVATAR_POLICY.minFaceConfidence) / 200;
    expect(service().judge(image(), [face(between)], SAFE)).toMatchObject({ decision: 'REVIEW' });
  });

  it('rejects a group photo', () => {
    const verdict = service().judge(image(), [face(0.97), face(0.95)], SAFE);
    expect(verdict).toMatchObject({ decision: 'REJECT', reason: 'MULTIPLE_FACES' });
  });

  it('ignores a faint extra face rather than calling a portrait a group photo', () => {
    // A blurry bystander in the background should not cost the uploader a retry.
    const verdict = service().judge(image(), [face(0.98), face(0.65)], SAFE);
    expect(verdict).toMatchObject({ decision: 'APPROVE' });
  });

  it('rejects a face that is a speck in a wide shot', () => {
    // 20×20 box in a 400×400 image = 0.25% coverage, well under the 5% floor.
    const verdict = service().judge(image(), [face(0.99, 20)], SAFE);
    expect(verdict).toMatchObject({ decision: 'REJECT', reason: 'FACE_TOO_SMALL' });
  });

  it('skips the coverage rule when the image header is unreadable', () => {
    const verdict = service().judge(Buffer.from('not an image'), [face(0.99, 20)], SAFE);
    expect(verdict).toMatchObject({ decision: 'APPROVE' });
  });

  it('rejects unsafe content even when the face itself is perfect', () => {
    const verdict = service().judge(image(), [face(0.99)], { ...SAFE, adult: 'VERY_LIKELY' });
    expect(verdict).toMatchObject({ decision: 'REJECT', reason: 'UNSAFE_CONTENT' });
  });

  it('treats a merely POSSIBLE safe-search hit as fine', () => {
    // POSSIBLE (50) sits under maxUnsafeConfidence (70) — an ordinary beach photo
    // should not be refused.
    const verdict = service().judge(image(), [face(0.99)], { ...SAFE, racy: 'POSSIBLE' });
    expect(verdict).toMatchObject({ decision: 'APPROVE' });
  });
});

describe('AvatarVisionService.check', () => {
  it('sends everything for human review when no provider is configured', async () => {
    const verdict = await service().check(image());
    expect(verdict).toMatchObject({ decision: 'REVIEW', faceScore: null });
  });

  it('reports the provider as disabled without an API key', () => {
    expect(service({ AVATAR_VISION_PROVIDER: 'google' } as Partial<Env>).isEnabled()).toBe(false);
  });
});
