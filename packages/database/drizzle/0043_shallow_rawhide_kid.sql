ALTER TABLE "party_reservation_documents" DROP CONSTRAINT "party_reservation_documents_terms_snapshot_array_ck";--> statement-breakpoint
-- Hand-edited (not drizzle-generated): a plain ALTER COLUMN TYPE from
-- text to jsonb is not an implicit cast in Postgres and requires an
-- explicit USING clause. Any existing row's `terms_snapshot` text was
-- always written as a valid JSON array string (see 0042's own insert
-- path), so this cast is safe.
ALTER TABLE "party_reservation_documents" ALTER COLUMN "terms_snapshot" SET DATA TYPE jsonb USING "terms_snapshot"::jsonb;--> statement-breakpoint
ALTER TABLE "party_reservation_documents" ADD CONSTRAINT "party_reservation_documents_terms_snapshot_array_ck" CHECK ("party_reservation_documents"."terms_snapshot" is null or jsonb_typeof("party_reservation_documents"."terms_snapshot") = 'array');