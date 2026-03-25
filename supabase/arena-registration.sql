-- Arena Registration / Sign-up table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS arena_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  signed_up_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, discord_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_signups_tournament ON arena_signups(tournament_id);

-- RLS
ALTER TABLE arena_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Arena signups readable by all" ON arena_signups FOR SELECT USING (true);
CREATE POLICY "Arena signups writable by all" ON arena_signups FOR ALL USING (true);

-- Enable realtime for live signup updates
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'arena_signups') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE arena_signups;
  END IF;
END $$;
