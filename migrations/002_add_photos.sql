-- migrations/002_add_photos.sql
-- Add photos column to items table

ALTER TABLE items ADD COLUMN IF NOT EXISTS photos TEXT[];
