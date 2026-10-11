-- Migration: the meter sends the game account's nickname with each synced character.
-- Characters that share a nickname belong to the same account, so the sync
-- can give them one account_number without the owner sorting them by hand.
ALTER TABLE players ADD COLUMN IF NOT EXISTS account_name TEXT;
