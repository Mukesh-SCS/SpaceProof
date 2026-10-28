-- AlterTable
ALTER TABLE "RoomMeasurement" ADD COLUMN     "placementLabel" TEXT,
ADD COLUMN     "placementMaxX" DOUBLE PRECISION,
ADD COLUMN     "placementMaxY" DOUBLE PRECISION,
ADD COLUMN     "placementMinX" DOUBLE PRECISION,
ADD COLUMN     "placementMinY" DOUBLE PRECISION,
ADD COLUMN     "placementSource" TEXT;
