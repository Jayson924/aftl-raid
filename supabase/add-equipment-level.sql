-- Add equipment level columns for weapon and armor
-- Values: '40' or '50', NULL means not set (defaults to 50 assumption)
-- Only relevant for 'unique' and 'legend' rarity equipment

ALTER TABLE players ADD COLUMN IF NOT EXISTS weapon_level TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS armor_level TEXT;
