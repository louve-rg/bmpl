-- Admin-controlled ad placement (commerce/advertising). PromotionPlacement gains
-- placement-level eligibility (isActive + start/end window + device visibility) and
-- an assignedById, so Admin — not the business — decides WHERE an approved campaign
-- appears, and placement eligibility is enforced IN ADDITION TO campaign eligibility.
CREATE TYPE "PromotionDevice" AS ENUM ('BOTH', 'DESKTOP', 'MOBILE');

ALTER TABLE "promotion_placements"
  ADD COLUMN "assignedById" TEXT,
  ADD COLUMN "device" "PromotionDevice" NOT NULL DEFAULT 'BOTH',
  ADD COLUMN "endAt" TIMESTAMP(3),
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "startAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
