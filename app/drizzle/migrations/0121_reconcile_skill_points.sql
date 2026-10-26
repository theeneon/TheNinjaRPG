-- Fill missing earned points up to one per level 31-60 for Chunin+ ranks.
-- Preserve existing totals: those points may already fund activated skills.
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
  AND `skillPoints` < CASE
    WHEN `rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
      THEN LEAST(GREATEST(`level` - 30, 0), 30)
    ELSE 0
  END;
