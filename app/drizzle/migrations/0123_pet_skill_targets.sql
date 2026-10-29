-- Preserve each species' recipient choice on every tag, retaining tag order and payloads.
WITH RECURSIVE `targeted` (`id`, `skillTarget`, `tagIndex`, `tags`) AS (
  SELECT `id`, `skillTarget`, 0, JSON_ARRAY() FROM `PetSpecies`
  UNION ALL
  SELECT `targeted`.`id`, `targeted`.`skillTarget`, `targeted`.`tagIndex` + 1,
    JSON_ARRAY_APPEND(`targeted`.`tags`, '$', JSON_SET(
      JSON_EXTRACT(`species`.`effects`, CONCAT('$[', `targeted`.`tagIndex`, ']')),
      '$.skillTarget', `targeted`.`skillTarget`
    ))
  FROM `targeted`
  JOIN `PetSpecies` AS `species` ON `species`.`id` = `targeted`.`id`
  WHERE `targeted`.`tagIndex` < JSON_LENGTH(`species`.`effects`)
)
UPDATE `PetSpecies` AS `species`
JOIN `targeted` ON `targeted`.`id` = `species`.`id`
  AND `targeted`.`tagIndex` = JSON_LENGTH(`species`.`effects`)
SET `species`.`effects` = `targeted`.`tags`;
ALTER TABLE `PetSpecies` DROP COLUMN `skillTarget`;
