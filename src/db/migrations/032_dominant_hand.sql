ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dominant_hand VARCHAR(20)
    CHECK (dominant_hand IN ('right-handed', 'left-handed'));
