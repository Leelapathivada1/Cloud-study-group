-- Enable pgcrypto for gen_random_uuid if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  created_at timestamptz DEFAULT now(),
  status text DEFAULT 'active'
);

-- Members / waiting queue
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  socket_id text,
  subject text NOT NULL,
  desired_size int DEFAULT 2,
  availability_start timestamptz,
  availability_end timestamptz,
  joined_at timestamptz DEFAULT now(),
  room_id uuid REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_members_subject ON members (subject);
