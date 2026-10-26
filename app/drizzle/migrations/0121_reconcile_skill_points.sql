-- Reconcile total earned points to one per level 31-60 for Chunin+ ranks.
-- Ranks below Chunin cannot hold skill points, regardless of level.
-- No quest skill points have been awarded at the time of this correction.
-- Active skill costs are deducted separately when calculating available points.
UPDATE `UserData`
SET `skillPoints` = CASE
    WHEN `rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
      THEN LEAST(GREATEST(`level` - 30, 0), 30)
    ELSE 0
  END,
  `updatedAt` = GREATEST(CURRENT_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, `updatedAt`))
WHERE `isAi` = 0
  AND (
    `level` >= 31
    OR `rank` NOT IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
  )
  AND `skillPoints` <> CASE
    WHEN `rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
      THEN LEAST(GREATEST(`level` - 30, 0), 30)
    ELSE 0
  END;
