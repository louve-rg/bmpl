import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AVATAR_POLICY,
  AVATAR_REJECTION_REASONS,
  readImageSize,
  type AvatarRejectionReason,
} from '@bmpl/shared';
import { ENV } from '../config/config.module';
import { avatarVisionEnabled, type Env } from '../config/env';

/**
 * What the check concluded about an uploaded picture.
 *  - APPROVE: exactly one clearly-detected human face, big enough, safe content.
 *  - REJECT:  a rule failed in a way the uploader can act on (told why).
 *  - REVIEW:  uncertain, or the provider was unreachable. Goes to a human.
 *
 * REVIEW is the safe default for everything ambiguous. A false rejection is a
 * real person being told their own face isn't a face; a false approval is a
 * picture briefly visible until an admin looks. Only the first one is unfixable
 * from the user's side, so uncertainty always costs an admin's time, never theirs.
 */
export type AvatarVerdict =
  | { decision: 'APPROVE'; faceScore: number }
  | { decision: 'REJECT'; reason: AvatarRejectionReason; faceScore: number | null }
  | { decision: 'REVIEW'; note: string; faceScore: number | null };

/** Google's likelihood scale, mapped to a 0–100 confidence. */
const LIKELIHOOD_SCORE: Record<string, number> = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 0,
  UNLIKELY: 20,
  POSSIBLE: 50,
  LIKELY: 80,
  VERY_LIKELY: 100,
};

interface GoogleVertex {
  x?: number;
  y?: number;
}
interface GoogleFace {
  detectionConfidence?: number;
  boundingPoly?: { vertices?: GoogleVertex[] };
  fdBoundingPoly?: { vertices?: GoogleVertex[] };
}
interface GoogleAnnotateResponse {
  responses?: Array<{
    faceAnnotations?: GoogleFace[];
    safeSearchAnnotation?: Record<string, string>;
    error?: { message?: string };
  }>;
}

/**
 * Checks that an uploaded profile picture is actually a photo of a person.
 *
 * Provider-agnostic by design: {@link check} is the only thing callers see, and
 * the provider is selected by AVATAR_VISION_PROVIDER. With no provider
 * configured every picture returns REVIEW, so the platform runs correctly
 * without vision credentials and starts auto-approving the moment they exist.
 *
 * IMPORTANT — what this can and cannot prove. It verifies the image CONTAINS a
 * human face. It cannot verify the face belongs to the account holder; anyone
 * can upload a stranger's photo. Binding a face to an identity needs liveness
 * capture matched against an ID document, which is a KYC feature, not this one.
 */
@Injectable()
export class AvatarVisionService {
  private readonly logger = new Logger(AvatarVisionService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  isEnabled(): boolean {
    return avatarVisionEnabled(this.env);
  }

  async check(bytes: Buffer): Promise<AvatarVerdict> {
    if (!this.isEnabled()) {
      return { decision: 'REVIEW', note: 'No vision provider configured.', faceScore: null };
    }
    try {
      return await this.checkViaGoogle(bytes);
    } catch (err) {
      // Never fail an upload because a third party is down — queue it instead.
      this.logger.error(`Avatar vision check failed: ${String(err)}`);
      return { decision: 'REVIEW', note: 'Automatic check unavailable.', faceScore: null };
    }
  }

  private async checkViaGoogle(bytes: Buffer): Promise<AvatarVerdict> {
    const body = {
      requests: [
        {
          image: { content: bytes.toString('base64') },
          features: [
            // maxResults above 1 so a group photo is *seen* as a group and
            // rejected, rather than silently passing on its first face.
            { type: 'FACE_DETECTION', maxResults: 5 },
            { type: 'SAFE_SEARCH_DETECTION' },
          ],
        },
      ],
    };

    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(this.env.GOOGLE_VISION_API_KEY!)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.env.AVATAR_VISION_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      this.logger.error(`Google Vision returned HTTP ${res.status}`);
      return { decision: 'REVIEW', note: 'Automatic check unavailable.', faceScore: null };
    }

    const payload = (await res.json()) as GoogleAnnotateResponse;
    const result = payload.responses?.[0];
    if (!result || result.error) {
      this.logger.error(`Google Vision error: ${result?.error?.message ?? 'empty response'}`);
      return { decision: 'REVIEW', note: 'Automatic check unavailable.', faceScore: null };
    }

    return this.judge(bytes, result.faceAnnotations ?? [], result.safeSearchAnnotation ?? {});
  }

  /** Apply AVATAR_POLICY to a provider's findings. Pure — unit-tested directly. */
  judge(
    bytes: Buffer,
    faces: GoogleFace[],
    safeSearch: Record<string, string>,
  ): AvatarVerdict {
    // Unsafe content is checked first: it is a rejection regardless of how many
    // faces are in the frame.
    const unsafe = (['adult', 'violence', 'racy'] as const).find(
      (k) => (LIKELIHOOD_SCORE[safeSearch[k] ?? 'UNKNOWN'] ?? 0) >= AVATAR_POLICY.maxUnsafeConfidence,
    );
    if (unsafe) {
      return {
        decision: 'REJECT',
        reason: AVATAR_REJECTION_REASONS.UNSAFE_CONTENT,
        faceScore: null,
      };
    }

    // Google reports detectionConfidence as 0–1; the policy is expressed 0–100.
    const scored = faces
      .map((f) => ({ face: f, score: Math.round((f.detectionConfidence ?? 0) * 100) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (!best || best.score < AVATAR_POLICY.reviewFaceConfidence) {
      return { decision: 'REJECT', reason: AVATAR_REJECTION_REASONS.NO_FACE, faceScore: best?.score ?? 0 };
    }
    if (best.score < AVATAR_POLICY.minFaceConfidence) {
      // Saw something face-like but not confidently — a person in profile, heavy
      // shadow, a mask. Too plausible to reject, too weak to publish.
      return { decision: 'REVIEW', note: 'Low face-detection confidence.', faceScore: best.score };
    }

    // Only count the OTHER faces that were themselves confidently detected, so a
    // blurry bystander in the background doesn't reject a valid portrait.
    const confident = scored.filter((s) => s.score >= AVATAR_POLICY.minFaceConfidence);
    if (confident.length > AVATAR_POLICY.maxFaces) {
      return {
        decision: 'REJECT',
        reason: AVATAR_REJECTION_REASONS.MULTIPLE_FACES,
        faceScore: best.score,
      };
    }

    const coverage = faceCoverage(bytes, best.face);
    // Unknown coverage (unreadable header) skips the rule rather than guessing.
    if (coverage !== null && coverage < AVATAR_POLICY.minFaceCoverage) {
      return {
        decision: 'REJECT',
        reason: AVATAR_REJECTION_REASONS.FACE_TOO_SMALL,
        faceScore: best.score,
      };
    }

    return { decision: 'APPROVE', faceScore: best.score };
  }
}

/**
 * Fraction of the image area covered by the face's bounding box, or null when the
 * image dimensions or the box are unreadable. Prefers `fdBoundingPoly` (the tight
 * skin-area box) over `boundingPoly` (which includes headwear and can extend
 * beyond the image bounds).
 */
function faceCoverage(bytes: Buffer, face: GoogleFace): number | null {
  const size = readImageSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;

  const vertices = face.fdBoundingPoly?.vertices ?? face.boundingPoly?.vertices;
  if (!vertices || vertices.length < 2) return null;

  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  const boxWidth = Math.max(...xs) - Math.min(...xs);
  const boxHeight = Math.max(...ys) - Math.min(...ys);
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  return (boxWidth * boxHeight) / (size.width * size.height);
}
