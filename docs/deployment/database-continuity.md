# Database continuity through December 15, 2026

Nothing in this plan was executed against the deployed database. No plan was purchased.

## What Render documents

Checked October 30, 2026:

- [Render free instances](https://render.com/docs/free): a free Postgres database expires 30 days after creation. It is then inaccessible unless it is upgraded. After expiration there is a 14-day grace period. Render then deletes the database and its data. Free Postgres has no backups and no managed connection pooling. Storage is 1 GB. A free web service sleeps after 15 minutes without traffic.
- [Render pricing](https://render.com/pricing): the smallest paid Postgres plan is `0.1c-256mb`, 256 MB RAM, 100 connections, **$6 per month**, with 1 GB SSD included. Paid Postgres includes logical backup. Extra storage is listed at $0.30/GB. Point-in-time recovery on the Hobby workspace is listed as 3 days.

The owner reports that the current free database expires on **November 27, 2026**. That date was not visible from the public site. If it is correct, the database becomes inaccessible before judging ends on December 15, 2026, and the grace period ends around December 11, 2026. Waiting until after November 27 risks losing the catalog and the payment ledger.

Creating a new empty database does not restore the old rows.

## Option A: upgrade the current database

This keeps the same host and the same data if Render's upgrade path is used before deletion.

1. In the Render dashboard, open the existing Postgres instance.
2. Confirm the plan is Free and note the expiration date.
3. Change the compute plan to `0.1c-256mb` ($6/month). Do not create a second database.
4. Render's upgrade keeps the existing data for Postgres. It does not require a new `DATABASE_URL` if the same instance is upgraded.
5. After the upgrade, confirm the dashboard no longer shows a 30-day expiration.
6. Paid instances can take a logical backup. Take one after the upgrade and store it outside Render.
7. Open https://spaceproof.onrender.com/, confirm the catalog loads, and run one fit check. Do not create a new PayPal charge unless you intend to.

This is the smaller change. It needs a payment method and owner approval. It was not done here.

## Option B: replace the free database

Use this only if the upgrade is not possible. Do it before November 27, 2026. Free Render Postgres cannot make the backup for you.

1. Install PostgreSQL client tools that include `pg_dump` and `pg_restore`, or `psql`.
2. From the Render Postgres page, copy the external connection string into a local shell variable. Do not commit it.
3. Record the migration state:

   ```powershell
   cd web
   npx prisma migrate status
   ```

   The repository migrations are `20261028180206_init`, `20261028190753_scene_placement`, `20261029002800_product_category`, and `20261030120000_api_rate_window`.
4. Dump the current database, including the catalog, room versions, fit assessments, and payment ledger:

   ```powershell
   pg_dump --format=custom --no-owner --file=spaceproof-before-expiry.dump "$env:DATABASE_URL"
   ```

5. Prove the dump can be restored before you retire anything. Start a throwaway local Postgres, restore into it, and count rows:

   ```powershell
   pg_restore --dbname="$env:LOCAL_TEST_URL" --no-owner spaceproof-before-expiry.dump
   psql "$env:LOCAL_TEST_URL" -c "SELECT COUNT(*) FROM \"Product\"; SELECT COUNT(*) FROM \"PaymentTransaction\";"
   ```

   Compare those counts with the source database. If they differ, stop.
6. Create a new paid Postgres instance (`0.1c-256mb`) in the same region as the web service. Leave the old database in place until the new one is checked.
7. Restore the dump into the new instance. Do not run `prisma migrate reset`.
8. If `prisma migrate status` on the new database says a migration is unapplied, run only:

   ```powershell
   npx prisma migrate deploy
   ```

   `migrate deploy` applies pending files. It does not wipe data. `migrate dev` and `migrate reset` can.
9. In the Render web service, replace `DATABASE_URL` with the new internal connection string. Redeploy the web service. Do not delete the old database yet.
10. Test, in order: the catalog page loads, a fit check returns `FIT` or `DOES_NOT_FIT` for a known desk, Sample room still reaches the vision health URL, and an existing captured order is only read, not charged again. Then delete the old database only after those checks pass.

Photographs are not in Postgres. They do not need to be in the dump. PayPal's own records stay at PayPal; the dump preserves SpaceProof's ledger copy.
