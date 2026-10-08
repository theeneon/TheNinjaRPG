-- Apply through the separately maintained cutover runner, never `make dbpush`,
-- `drizzle-kit push` or `drizzle-kit migrate`. Between the two SQL sections below,
-- settle legacy training and stage effective Energy capacities in _EnergyPool.
-- Verify old player combat stats are at least 10 and preserve a verified backup.
-- Build without promoting, freeze gameplay writes, run the migration, then promote.
-- Keep writes frozen throughout: old and new builds cannot share this schema.
-- Converted stored values remain uncapped; rank/global battle caps limit their use.
-- The first ALTER refuses replay, preventing duplicate stat conversion.
-- If the schema section fails, inspect/repair partial execution before continuing.
-- After the schema section completes, `--resume-settlement` resumes the runner without
-- replaying it. If an Energy guard fails, drop _EnergyTrainingGuard before resuming;
-- no Energy columns changed yet. After an Energy ALTER fails, inspect partial execution
-- and finish only unapplied statements; never replay the full-pool backfill after play resumes.
ALTER TABLE `Item` ADD `requiredNinjutsuMastery` int;
ALTER TABLE `Item` ADD `requiredGenjutsuMastery` int;
ALTER TABLE `Item` ADD `requiredTaijutsuMastery` int;
ALTER TABLE `Item` ADD `requiredBukijutsuMastery` int;
ALTER TABLE `Item` ADD `requiredBloodlineMastery` int;
ALTER TABLE `Item` ADD `requiredSageMastery` int;
ALTER TABLE `Jutsu` ADD `requiredNinjutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredGenjutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredTaijutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredBukijutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredBloodlineMastery` int;
ALTER TABLE `Jutsu` ADD `requiredSageMastery` int;
ALTER TABLE `UserData` ADD `offence` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `defence` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `ninjutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `genjutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `taijutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `bukijutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `bloodlineMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `sageMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `masteryTrainingStartedAt` datetime(3);
ALTER TABLE `UserData` ADD `currentlyTrainingMastery` enum('ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery');
UPDATE `UserData`
SET
	`offence` = CASE WHEN `isAi` OR `isSummon` THEN GREATEST(`ninjutsuOffence`, `genjutsuOffence`, `taijutsuOffence`, `bukijutsuOffence`)
		ELSE 10 + (CAST(`ninjutsuOffence` AS DECIMAL(30, 10)) + CAST(`genjutsuOffence` AS DECIMAL(30, 10)) + CAST(`taijutsuOffence` AS DECIMAL(30, 10)) + CAST(`bukijutsuOffence` AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960 END,
	`defence` = CASE WHEN `isAi` OR `isSummon` THEN GREATEST(`ninjutsuDefence`, `genjutsuDefence`, `taijutsuDefence`, `bukijutsuDefence`)
		ELSE 10 + (CAST(`ninjutsuDefence` AS DECIMAL(30, 10)) + CAST(`genjutsuDefence` AS DECIMAL(30, 10)) + CAST(`taijutsuDefence` AS DECIMAL(30, 10)) + CAST(`bukijutsuDefence` AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960 END,
	`ninjutsuMastery` = GREATEST(`ninjutsuOffence`, `ninjutsuDefence`),
	`genjutsuMastery` = GREATEST(`genjutsuOffence`, `genjutsuDefence`),
	`taijutsuMastery` = GREATEST(`taijutsuOffence`, `taijutsuDefence`),
	`bukijutsuMastery` = GREATEST(`bukijutsuOffence`, `bukijutsuDefence`),
	`bloodlineMastery` = 10,
	`sageMastery` = 10;
ALTER TABLE `UserData` MODIFY COLUMN `currentlyTraining` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength','offence','defence');
-- Sessions in flight on a per-type stat keep running, with their start time, on the stat
-- it merged into, so they still pay experience when stopped.
UPDATE `UserData`
SET `currentlyTraining` = CASE
	WHEN `currentlyTraining` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence') THEN 'offence'
	ELSE 'defence'
END
WHERE `currentlyTraining` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence', 'ninjutsuDefence', 'genjutsuDefence', 'taijutsuDefence', 'bukijutsuDefence');
ALTER TABLE `TrainingLog` MODIFY COLUMN `stat` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength','offence','defence','ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery');
UPDATE `TrainingLog`
SET `stat` = CASE
	WHEN `stat` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence') THEN 'offence'
	ELSE 'defence'
END
WHERE `stat` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence', 'ninjutsuDefence', 'genjutsuDefence', 'taijutsuDefence', 'bukijutsuDefence');
ALTER TABLE `TrainingLog` MODIFY COLUMN `stat` enum('offence','defence','intelligence','speed','willpower','strength','ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery');
ALTER TABLE `UserData` MODIFY COLUMN `currentlyTraining` enum('offence','defence','intelligence','speed','willpower','strength');
-- Mastery training excludes minutes a combat session already credited. The cutoff has to
-- land in this update, not in TrainingLog, which is inserted afterwards.
ALTER TABLE `UserData` ADD `lastCombatTrainingFinishedAt` datetime(3);
UPDATE `UserData` AS `user`
INNER JOIN (
	SELECT `userId`, MAX(`trainingFinishedAt`) AS `finishedAt`
	FROM `TrainingLog`
	WHERE `stat` IN ('offence', 'defence', 'intelligence', 'speed', 'willpower', 'strength')
	GROUP BY `userId`
) AS `latest` ON `latest`.`userId` = `user`.`userId`
SET `user`.`lastCombatTrainingFinishedAt` = `latest`.`finishedAt`;
UPDATE `Jutsu`
SET
	`requiredNinjutsuMastery` = CASE
		WHEN `requiredNinjutsuOffence` IS NULL AND `requiredNinjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredNinjutsuOffence`, 0), COALESCE(`requiredNinjutsuDefence`, 0))
	END,
	`requiredGenjutsuMastery` = CASE
		WHEN `requiredGenjutsuOffence` IS NULL AND `requiredGenjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredGenjutsuOffence`, 0), COALESCE(`requiredGenjutsuDefence`, 0))
	END,
	`requiredTaijutsuMastery` = CASE
		WHEN `requiredTaijutsuOffence` IS NULL AND `requiredTaijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredTaijutsuOffence`, 0), COALESCE(`requiredTaijutsuDefence`, 0))
	END,
	`requiredBukijutsuMastery` = CASE
		WHEN `requiredBukijutsuOffence` IS NULL AND `requiredBukijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredBukijutsuOffence`, 0), COALESCE(`requiredBukijutsuDefence`, 0))
	END;
ALTER TABLE `Jutsu` DROP COLUMN `requiredNinjutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredNinjutsuDefence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredGenjutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredGenjutsuDefence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredTaijutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredTaijutsuDefence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredBukijutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredBukijutsuDefence`;
UPDATE `Item`
SET
	`requiredNinjutsuMastery` = CASE
		WHEN `requiredNinjutsuOffence` IS NULL AND `requiredNinjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredNinjutsuOffence`, 0), COALESCE(`requiredNinjutsuDefence`, 0))
	END,
	`requiredGenjutsuMastery` = CASE
		WHEN `requiredGenjutsuOffence` IS NULL AND `requiredGenjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredGenjutsuOffence`, 0), COALESCE(`requiredGenjutsuDefence`, 0))
	END,
	`requiredTaijutsuMastery` = CASE
		WHEN `requiredTaijutsuOffence` IS NULL AND `requiredTaijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredTaijutsuOffence`, 0), COALESCE(`requiredTaijutsuDefence`, 0))
	END,
	`requiredBukijutsuMastery` = CASE
		WHEN `requiredBukijutsuOffence` IS NULL AND `requiredBukijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredBukijutsuOffence`, 0), COALESCE(`requiredBukijutsuDefence`, 0))
	END;
ALTER TABLE `Item` DROP COLUMN `requiredNinjutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredNinjutsuDefence`;
ALTER TABLE `Item` DROP COLUMN `requiredGenjutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredGenjutsuDefence`;
ALTER TABLE `Item` DROP COLUMN `requiredTaijutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredTaijutsuDefence`;
ALTER TABLE `Item` DROP COLUMN `requiredBukijutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredBukijutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `ninjutsuOffence`;
ALTER TABLE `UserData` DROP COLUMN `ninjutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `genjutsuOffence`;
ALTER TABLE `UserData` DROP COLUMN `genjutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `taijutsuOffence`;
ALTER TABLE `UserData` DROP COLUMN `taijutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `bukijutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `bukijutsuOffence`;
UPDATE `UserData`
SET `battleId` = NULL, `status` = 'AWAKE', `travelFinishAt` = NULL
WHERE `battleId` IS NOT NULL;
-- Open raid, shrine and clan queues whose battle is deleted would still count as started and
-- lock their members out of every queue, and undecided tournament matches would keep their
-- fight button hidden. Remove those queues and reopen those matches.
DELETE `u` FROM `MpvpBattleUser` `u`
JOIN `MpvpBattleQueue` `q` ON `q`.`id` = `u`.`clanBattleId`
WHERE `q`.`winnerId` IS NULL AND `q`.`battleId` IN (SELECT `id` FROM `Battle`);
DELETE FROM `MpvpBattleQueue`
WHERE `winnerId` IS NULL AND `battleId` IN (SELECT `id` FROM (SELECT `id` FROM `Battle`) `b`);
UPDATE `TournamentMatch`
SET `battleId` = NULL
WHERE `winnerId` IS NULL AND `battleId` IN (SELECT `id` FROM `Battle`);
DELETE FROM `Battle`;
-- Saved damage simulations keep each side's stats as JSON under the old per-type names.
-- Apply the player investment conversion, defaulting a missing stat to 10.
UPDATE `DamageCalculation`
SET `state` = JSON_REMOVE(
	JSON_SET(
		`state`,
		'$.attacker.offence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.ninjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.genjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.taijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.bukijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960,
		'$.attacker.defence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.ninjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.genjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.taijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.bukijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960,
		'$.defender.offence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.ninjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.genjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.taijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.bukijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960,
		'$.defender.defence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.ninjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.genjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.taijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.bukijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960
	),
	'$.attacker.ninjutsuOffence', '$.attacker.genjutsuOffence', '$.attacker.taijutsuOffence', '$.attacker.bukijutsuOffence',
	'$.attacker.ninjutsuDefence', '$.attacker.genjutsuDefence', '$.attacker.taijutsuDefence', '$.attacker.bukijutsuDefence',
	'$.defender.ninjutsuOffence', '$.defender.genjutsuOffence', '$.defender.taijutsuOffence', '$.defender.bukijutsuOffence',
	'$.defender.ninjutsuDefence', '$.defender.genjutsuDefence', '$.defender.taijutsuDefence', '$.defender.bukijutsuDefence'
)
WHERE JSON_CONTAINS_PATH(
	`state`, 'one',
	'$.attacker.ninjutsuOffence', '$.attacker.genjutsuOffence', '$.attacker.taijutsuOffence', '$.attacker.bukijutsuOffence',
	'$.attacker.ninjutsuDefence', '$.attacker.genjutsuDefence', '$.attacker.taijutsuDefence', '$.attacker.bukijutsuDefence',
	'$.defender.ninjutsuOffence', '$.defender.genjutsuOffence', '$.defender.taijutsuOffence', '$.defender.bukijutsuOffence',
	'$.defender.ninjutsuDefence', '$.defender.genjutsuDefence', '$.defender.taijutsuDefence', '$.defender.bukijutsuDefence'
);
-- Seeded guide articles and content are never overwritten, so text describing the per-type
-- stats is corrected here. Each update is guarded on the old wording and leaves a row that
-- was edited since untouched.
UPDATE `GuideArticle`
SET `content` = REPLACE(`content`, 'Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.', 'Spend Energy to train Offence instantly, and train a mastery such as Taijutsu in timed sessions alongside it to unlock jutsu and gear of that type.')
WHERE `slug` = 'getting-started' AND `content` LIKE '%Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.%';
-- Jutsu text follows the shared stats and actual effects. Full-description corrections
-- require unchanged wording and effect types/targets so subsequent staff edits are preserved.
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'crippling their taijutsu and bukijutsu power', 'crippling their Offence, Strength and Speed')
WHERE `id` = 'hdlYuZCWCXn02GUPBEzBk' AND `description` LIKE '%crippling their taijutsu and bukijutsu power%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'reducing their Genjutsu capabilities', 'reducing their Offence, Intelligence and Willpower')
WHERE `id` = '_bb_t15T2F8E6OBEk-S3U' AND `description` LIKE '%reducing their Genjutsu capabilities%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'diminishing their Genjutsu prowess', 'diminishing their Offence, Intelligence and Willpower')
WHERE `id` = '_bb_t15T2F8E6OBEk-S3U' AND `battleDescription` LIKE '%diminishing their Genjutsu prowess%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'genjutsu offense, intelligence, and willpower', 'Offence, Intelligence and Willpower')
WHERE `id` = 'i_tI_-M-GUfQNn25E7dte' AND `description` LIKE '%genjutsu offense, intelligence, and willpower%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'genjutsu offense, intelligence, and willpower', 'Offence, Intelligence and Willpower')
WHERE `id` = 'i_tI_-M-GUfQNn25E7dte' AND `battleDescription` LIKE '%genjutsu offense, intelligence, and willpower%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'boosting their ninjutsu potency', 'boosting their Offence')
WHERE `id` = '8762uSiA_XClK36cuE9Cw' AND `battleDescription` LIKE '%boosting their ninjutsu potency%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'Bukijutsu, Strength, and Speed', 'Offence, Strength and Speed')
WHERE `id` = 'sBc4_bIw5xCB-39X6FcJy' AND `description` LIKE '%Bukijutsu, Strength, and Speed%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'heightening their Bukijutsu might, strength, and speed', 'heightening their Offence, Strength and Speed')
WHERE `id` = 'sBc4_bIw5xCB-39X6FcJy' AND `battleDescription` LIKE '%heightening their Bukijutsu might, strength, and speed%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'hand-to-hand power', 'Offence, Strength and Speed')
WHERE `id` = 'x5FfBkac3YfROuNojxU8k' AND `description` LIKE '%hand-to-hand power%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'sharpening their Taijutsu ability', 'sharpening their Offence')
WHERE `id` = 'x5FfBkac3YfROuNojxU8k' AND `battleDescription` LIKE '%sharpening their Taijutsu ability%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'bukijutsu offense', 'bukijutsu damage')
WHERE `id` = '_BTsbIMz0WUWczPp9iRyW' AND `description` LIKE '%bukijutsu offense%';
UPDATE `Jutsu`
SET `description` = 'A stormborn genjutsu that damages the enemy and increases the damage they take.'
WHERE `id` = 'eJISnE5IrvC09FuoeuQ5X' AND `description` = 'A stormborn genjutsu that increases the user''s offensive stats while weakening the enemy’s genjutsu defense, intelligence, and willpower.'
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'increasedamagetaken') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'INHERIT');
UPDATE `Jutsu`
SET `battleDescription` = '%user conjures a storm of phantom lightning in %target’s mind. The mental assault deals damage and leaves %target more vulnerable to subsequent attacks.'
WHERE `id` = 'eJISnE5IrvC09FuoeuQ5X' AND `battleDescription` = '%user invokes a wrathful storm within the target’s mind—**Arashi Ikari**, the Tempest of Fury. Thunder cracks and phantom lightning arcs through a mental maelstrom, amplifying the user’s genjutsu chakra to overwhelming levels. At the same time, %target’s mental defenses are shredded by roaring winds and blinding flashes, reducing their intelligence and willpower to resist. The storm leaves the battlefield unscathed—but in the minds of those caught in it, chaos reigns.'
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'increasedamagetaken') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'INHERIT');
UPDATE `Jutsu`
SET `description` = 'A barrage of flaming kunai that damages the enemy and leaves them burning.'
WHERE `id` = 'iioSrLkg_-jlX5xIycMYr' AND `description` = 'A rapid-fire attack where flaming kunai are thrown in a barrage. Decreases Target Defensive stats while boosting caster offense. '
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'afterburn') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'INHERIT');
UPDATE `Jutsu`
SET `battleDescription` = '%user unleashes a relentless stream of flaming kunai at %target. Each strike sears the enemy, leaving flames that continue to burn after the initial impact.'
WHERE `id` = 'iioSrLkg_-jlX5xIycMYr' AND `battleDescription` = '%user unleashes a relentless stream of flaming kunai at %target, each one carving through the air with searing heat. The scorching impact disrupts the enemy’s form, weakening their Bukijutsu defenses. As the flames intensify, %user’s offensive presence surges, their strikes becoming even more aggressive and empowered.'
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'afterburn') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'INHERIT');
UPDATE `Jutsu`
SET `description` = 'A spiraling blaze of fire chakra that damages the enemy and leaves them burning.'
WHERE `id` = 'mdIWNxovAIVj_8esBaYGX' AND `description` = 'A blazing surge of chakra that fuels the user’s ninjutsu while mentally disorienting and weakening the enemy’s defenses.'
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'afterburn') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'INHERIT');
UPDATE `Jutsu`
SET `battleDescription` = '%user channels refined fire chakra into a spiraling blaze that engulfs %target. The scorching flames deal damage and continue to burn after the initial impact.'
WHERE `id` = 'mdIWNxovAIVj_8esBaYGX' AND `battleDescription` = '%user channels refined fire chakra into a spiraling blaze that amplifies their ninjutsu potency. The heat distorts the air and attacks %target’s clarity and mental resistance, lowering their ability to defend against future techniques by weakening their ninjutsu defense, intelligence, and willpower.'
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'afterburn') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'INHERIT');
UPDATE `Jutsu`
SET `description` = 'A lightning technique that damages the enemy and reduces the damage the user takes.'
WHERE `id` = 'TI1JQAG1ltx_uLHE9-UUs' AND `description` = 'A chaining lightning technique that enhances the user’s power while weakening the opponent’s mental and chakra resilience.'
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'decreasedamagetaken') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'SELF');
UPDATE `Jutsu`
SET `battleDescription` = '%user channels lightning chakra through their body before sending sparks arcing toward %target. The strike deals damage while the surrounding chakra shields %user, reducing the damage they take.'
WHERE `id` = 'TI1JQAG1ltx_uLHE9-UUs' AND `battleDescription` = '%user channels a concentrated flow of lightning chakra through their body, heightening their offensive capabilities. Sparks then arc across the battlefield toward %target, surging through their chakra network and diminishing their resistance to ninjutsu by weakening their intelligence, willpower, and ninjutsu defenses.'
	AND JSON_EXTRACT(`effects`, '$[*].type') = JSON_ARRAY('damage', 'decreasedamagetaken') AND JSON_EXTRACT(`effects`, '$[*].target') = JSON_ARRAY('INHERIT', 'SELF');
ALTER TABLE `Bloodline` MODIFY COLUMN `statClassification` enum('Highest','None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
UPDATE `Bloodline` SET `statClassification` = 'None' WHERE `statClassification` = 'Highest';
ALTER TABLE `Bloodline` MODIFY COLUMN `statClassification` enum('None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
ALTER TABLE `Jutsu` MODIFY COLUMN `statClassification` enum('Highest','None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
UPDATE `Jutsu` SET `statClassification` = 'None' WHERE `statClassification` = 'Highest';
ALTER TABLE `Jutsu` MODIFY COLUMN `statClassification` enum('None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
ALTER TABLE `UserData` DROP COLUMN `preferredStat`;

-- Energy cutover (after training settlement)
CREATE TABLE `_EnergyTrainingGuard` (`id` int PRIMARY KEY);
INSERT INTO `_EnergyTrainingGuard` VALUES (1);
INSERT INTO `_EnergyTrainingGuard` SELECT 1 FROM `UserData` WHERE `currentlyTraining` IS NOT NULL OR `currentlyTrainingMastery` IS NOT NULL LIMIT 1;
INSERT INTO `_EnergyTrainingGuard` SELECT 1 FROM `UserData` LEFT JOIN `_EnergyPool` ON `UserData`.`userId` = `_EnergyPool`.`userId` WHERE `_EnergyPool`.`userId` IS NULL LIMIT 1;
DROP TABLE `_EnergyTrainingGuard`;
ALTER TABLE `UserData` ADD `curEnergy` double DEFAULT 100 NOT NULL;
ALTER TABLE `UserData` ADD `maxEnergy` double DEFAULT 100 NOT NULL;
UPDATE `UserData` JOIN `_EnergyPool` ON `UserData`.`userId` = `_EnergyPool`.`userId` SET `maxEnergy` = `_EnergyPool`.`capacity`, `curEnergy` = `_EnergyPool`.`capacity`;
DROP TABLE `_EnergyPool`;
ALTER TABLE `UserData` DROP COLUMN `trainingStartedAt`;
ALTER TABLE `UserData` DROP COLUMN `lastCombatTrainingFinishedAt`;
ALTER TABLE `UserData` DROP COLUMN `currentlyTraining`;
-- Preserve staff edits while updating legacy and mastery-era getting-started guidance.
UPDATE `GuideArticle`
SET `content` = REPLACE(`content`, 'Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.', 'Spend Energy to train Offence instantly, and train a mastery such as Taijutsu in timed sessions alongside it to unlock jutsu and gear of that type.')
WHERE `slug` = 'getting-started' AND `content` LIKE '%Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.%';
UPDATE `GuideArticle`
SET `content` = REPLACE(`content`, 'Train Offence in short 15-minute bouts when you can, and a mastery such as Taijutsu alongside it to unlock jutsu and gear of that type.', 'Spend Energy to train Offence instantly, and train a mastery such as Taijutsu in timed sessions alongside it to unlock jutsu and gear of that type.')
WHERE `slug` = 'getting-started' AND `content` LIKE '%Train Offence in short 15-minute bouts when you can, and a mastery such as Taijutsu alongside it to unlock jutsu and gear of that type.%';
