-- Enable Realtime for arena_reactions table
-- Required for fighters and other spectators to see reactions in real time

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'arena_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE arena_reactions;
  END IF;
END $$;
