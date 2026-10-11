-- Migration: per-character values the game never sends (title, card mastery, collection
-- level, engravings, buff levels), set on the simulator and kept across meter syncs.
ALTER TABLE players ADD COLUMN IF NOT EXISTS overrides JSONB;
