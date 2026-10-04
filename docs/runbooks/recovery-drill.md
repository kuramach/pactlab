# Recovery drill

Prove we can restore PostgreSQL and object storage, and that restored data is
intact. Run before the pilot opens, then every 90 days, and after any change
to backup configuration. Drills restore **into stage or a dedicated recovery
environment**, never into a lower environment: production data must not
reach dev or QA.

## Targets

| Store            | Backup                                              | Restore objective                                       |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------- |
| PostgreSQL (RDS) | Automated backups, 35 days in prod, PITR            | Point in time within 5 minutes; under 2 hours to usable |
| Evidence bucket  | S3 versioning, noncurrent versions retained 90 days | Any version within retention                            |
| Audit archive    | S3 Object Lock (compliance, prod)                   | Objects immutable until retention ends                  |
| Redis            | Snapshots (7 days, prod)                            | Rebuildable; jobs are idempotent and replay-safe        |

## PostgreSQL drill

1. Pick a restore time `T` (UTC) and record it.
2. With the authorized drill role (not a routine profile), restore to a new
   instance:

   ```bash
   aws rds restore-db-instance-to-point-in-time --profile <drill-profile> \
     --source-db-instance-identifier <prod-instance-id> \
     --target-db-instance-identifier pactlab-drill-<yyyymmdd> \
     --restore-time <T> --db-subnet-group-name <isolated-subnet-group> \
     --no-publicly-accessible
   ```

3. Verify, read-only, against the restored instance:
   - row counts for `organizations`, `deals`, `evidence_items`,
     `audit_events` match expectations at `T`;
   - RLS is still enabled on every tenant table;
   - the audit hash chain verifies for every organization
     (`verifyAuditChain` in `@pactlab/db`);
   - a sample of evidence items resolves to stored files by checksum.
4. Record elapsed time against the objective.
5. Delete the drill instance (it is not a protected stack resource) and record
   the deletion.

## S3 drill

1. In the evidence bucket, pick a test object written by the drill (never a
   customer object) and delete it, creating a delete marker.
2. List versions and restore by removing the delete marker:

   ```bash
   aws s3api list-object-versions --profile <drill-profile> --bucket <bucket> --prefix <key>
   aws s3api delete-object --profile <drill-profile> --bucket <bucket> --key <key> \
     --version-id <delete-marker-version-id>
   ```

3. Verify the object's checksum matches the stored file record.
4. Confirm an attempt to delete a locked audit-archive object version fails.

## Record

Drill date, operator, restore time, elapsed time, verification results,
deviations and follow-ups go in the operations log. A failed drill blocks the
pilot go/no-go until fixed and re-run.
