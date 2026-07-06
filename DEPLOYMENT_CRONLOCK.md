# CronLock Table Migration Deployment Guide

## Overview

This guide documents the deployment of the CronLock table migration, which adds a distributed cron locking mechanism to prevent concurrent execution of scheduled jobs across multiple replicas.

## Files Created/Modified

### 1. Migration File
- **Path**: `prisma/migrations/20260706_add_cron_lock_table/migration.sql`
- **Purpose**: SQL migration to create the CronLock table
- **Content**:
  ```sql
  CREATE TABLE "CronLock" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "lockedAt" TIMESTAMPTZ NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL
  );
  
  CREATE INDEX "CronLock_expiresAt_idx" ON "CronLock"("expiresAt");
  ```

### 2. Migration Script
- **Path**: `scripts/apply-migrations.sh`
- **Purpose**: Dedicated script to handle database migrations during deployment
- **Features**:
  - Waits for PostgreSQL to be ready
  - Runs `prisma migrate deploy`
  - Falls back to `prisma db push` if migration fails
  - Handles errors gracefully

### 3. Updated Entrypoint
- **Path**: `docker-entrypoint.sh`
- **Changes**: Modified to call the dedicated migration script
- **Benefit**: Cleaner separation of concerns and better error handling

### 4. Dockerfile
- **Path**: `Dockerfile.coolify`
- **Status**: Already configured to copy scripts directory

## Deployment Process

### Automatic Deployment (Recommended)

The migration will be automatically applied during container startup:

1. **Container starts** → `docker-entrypoint.sh` is executed
2. **Database check** → Waits for PostgreSQL to be ready
3. **Migration script** → `scripts/apply-migrations.sh` runs:
   - Attempts `prisma migrate deploy`
   - Falls back to `prisma db push` if needed
4. **Application starts** → Next.js server launches

### Manual Deployment (If Needed)

If you need to apply migrations manually:

```bash
# Enter the container
docker exec -it golradar-app sh

# Run the migration script
./scripts/apply-migrations.sh
```

## Verification

### Check Migration Status

```bash
# Connect to PostgreSQL
psql postgresql://postgres:golradar_secret@localhost:5432/golradar_db

# Verify table exists
\dt "CronLock"

# Check table structure
\d+ "CronLock"
```

### Expected Output

```
List of relations
 Schema |  Name   | Type  | Owner
--------+---------+-------+--------
 public | CronLock | table | postgres

Table "public.CronLock"
 Column   |           Type           | Collation | Nullable | Default | Storage  | Stats target | Description
-----------+--------------------------+-----------+----------+---------+----------+--------------+-------------
 key       | text                     |           | not null |         | extended |              |
 lockedAt  | timestamp with time zone |           | not null |         | plain    |              |
 expiresAt | timestamp with time zone |           | not null |         | plain    |              |
Indexes:
    "CronLock_pkey" PRIMARY KEY, btree (key)
    "CronLock_expiresAt_idx" btree (expiresAt)
```

## Rollback Plan

If issues occur with the migration:

1. **Check logs**:
   ```bash
   docker logs golradar-app
   ```

2. **Manual rollback** (if needed):
   ```bash
   # Connect to database
   psql postgresql://postgres:golradar_secret@localhost:5432/golradar_db
   
   # Drop the table
   DROP TABLE IF EXISTS "CronLock";
   ```

3. **Re-deploy**: The migration is idempotent and can be safely re-run

## Usage in Application

The CronLock table is used for distributed locking:

```typescript
// Example: Acquiring a lock
const lockKey = 'daily-calibration';
const lockDuration = 5 * 60 * 1000; // 5 minutes

// Try to acquire lock
const existingLock = await prisma.cronLock.findUnique({
  where: { key: lockKey }
});

if (existingLock && new Date(existingLock.expiresAt) > new Date()) {
  // Lock is still valid, skip execution
  return;
}

// Acquire new lock
await prisma.cronLock.upsert({
  where: { key: lockKey },
  create: {
    key: lockKey,
    lockedAt: new Date(),
    expiresAt: new Date(Date.now() + lockDuration)
  },
  update: {
    lockedAt: new Date(),
    expiresAt: new Date(Date.now() + lockDuration)
  }
});

// Execute cron job...
```

## Monitoring

### Check for Expired Locks

```sql
-- Find expired locks that should be cleaned up
SELECT "key", "lockedAt", "expiresAt"
FROM "CronLock"
WHERE "expiresAt" < NOW();
```

### Cleanup Expired Locks

```sql
-- Clean up expired locks
DELETE FROM "CronLock"
WHERE "expiresAt" < NOW();
```

## Troubleshooting

### Issue: Migration fails with timeout
**Solution**: Increase database connection timeout in `docker-entrypoint.sh`

### Issue: Permission denied on migration files
**Solution**: Ensure proper volume permissions:
```bash
docker exec -it golradar-app chmod -R 755 /app/prisma/migrations
```

### Issue: Migration already applied
**Solution**: The migration is idempotent. If already applied, it will be skipped automatically.

## Deployment Checklist

- [x] Migration SQL file created
- [x] Migration script created and made executable
- [x] Entrypoint updated to use migration script
- [x] Dockerfile configured to copy scripts
- [x] Documentation created
- [x] Rollback plan documented
- [x] Verification steps documented

## Next Steps

1. Commit changes to version control
2. Deploy using `docker-compose up -d` or your preferred deployment method
3. Monitor logs for migration success
4. Verify table exists in database
