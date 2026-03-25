-- Add match_format column to arena_challenges
-- So the challenger can specify 1v1, 2v2, or 3v3
ALTER TABLE arena_challenges ADD COLUMN IF NOT EXISTS match_format INTEGER NOT NULL DEFAULT 1;
