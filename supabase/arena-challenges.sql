-- Arena Challenges table
-- Player-to-player challenge system with 15s accept window

CREATE TABLE IF NOT EXISTS arena_challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenger_discord_id TEXT NOT NULL,
  challenged_discord_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  match_id UUID REFERENCES arena_matches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 seconds')
);

CREATE INDEX idx_arena_challenges_challenged ON arena_challenges(challenged_discord_id, status);
CREATE INDEX idx_arena_challenges_challenger ON arena_challenges(challenger_discord_id, status);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE arena_challenges;

-- RLS
ALTER TABLE arena_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read challenges" ON arena_challenges FOR SELECT USING (true);
CREATE POLICY "Anyone can insert challenges" ON arena_challenges FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update challenges" ON arena_challenges FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete challenges" ON arena_challenges FOR DELETE USING (true);
