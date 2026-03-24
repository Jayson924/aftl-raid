-- Add match_format column to tournaments and matches
-- Format: 1 = 1v1 (1 char, first to 1 win), 2 = 2v2, 3 = 3v3 (best of 3)
-- Default: 1 (1v1)

ALTER TABLE arena_tournaments ADD COLUMN IF NOT EXISTS match_format INTEGER NOT NULL DEFAULT 1;
ALTER TABLE arena_matches ADD COLUMN IF NOT EXISTS match_format INTEGER NOT NULL DEFAULT 1;
