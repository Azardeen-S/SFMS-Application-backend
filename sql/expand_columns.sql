-- Expand Closure and Phenomena column sizes to allow proper text input
-- These were too short (10 and 50 chars) to be useful for resolution details

ALTER TABLE "Trn_LineStoppage" ALTER COLUMN "Closure" TYPE text;
ALTER TABLE "Trn_LineStoppage" ALTER COLUMN "Phenomena" TYPE text;
ALTER TABLE "Trn_LineStoppage" ALTER COLUMN "Vendor" TYPE text;
ALTER TABLE "Trn_LineStoppage" ALTER COLUMN "Material" TYPE text;
