#!/bin/sh

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   CronLock Migration Setup Verification                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

# Check 1: Migration SQL file exists
echo "🔍 Checking migration SQL file..."
if [ -f "prisma/migrations/20260706_add_cron_lock_table/migration.sql" ]; then
    echo "${GREEN}✓${NC} Migration SQL file exists"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} Migration SQL file NOT found"
    FAIL=$((FAIL + 1))
fi

# Check 2: Migration script exists
echo "🔍 Checking migration script..."
if [ -f "scripts/apply-migrations.sh" ]; then
    echo "${GREEN}✓${NC} Migration script exists"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} Migration script NOT found"
    FAIL=$((FAIL + 1))
fi

# Check 3: Migration script is executable
echo "🔍 Checking migration script permissions..."
if [ -x "scripts/apply-migrations.sh" ]; then
    echo "${GREEN}✓${NC} Migration script is executable"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} Migration script is NOT executable"
    FAIL=$((FAIL + 1))
fi

# Check 4: Entrypoint references migration script
echo "🔍 Checking docker-entrypoint.sh..."
if grep -q "apply-migrations.sh" docker-entrypoint.sh; then
    echo "${GREEN}✓${NC} Entrypoint calls migration script"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} Entrypoint does NOT call migration script"
    FAIL=$((FAIL + 1))
fi

# Check 5: Prisma schema includes CronLock model
echo "🔍 Checking Prisma schema..."
if grep -q "model CronLock" prisma/schema.prisma; then
    echo "${GREEN}✓${NC} CronLock model defined in schema"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} CronLock model NOT found in schema"
    FAIL=$((FAIL + 1))
fi

# Check 6: Dockerfile copies scripts
echo "🔍 Checking Dockerfile..."
if grep -q "COPY.*scripts" Dockerfile.coolify; then
    echo "${GREEN}✓${NC} Dockerfile copies scripts directory"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} Dockerfile does NOT copy scripts directory"
    FAIL=$((FAIL + 1))
fi

# Check 7: Migration SQL content
echo "🔍 Checking migration SQL content..."
if grep -q 'CREATE TABLE "CronLock"' prisma/migrations/20260706_add_cron_lock_table/migration.sql; then
    echo "${GREEN}✓${NC} Migration SQL creates CronLock table"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} Migration SQL does NOT create CronLock table"
    FAIL=$((FAIL + 1))
fi

# Check 8: Index creation
echo "🔍 Checking index creation..."
if grep -q 'CREATE INDEX.*expiresAt' prisma/migrations/20260706_add_cron_lock_table/migration.sql; then
    echo "${GREEN}✓${NC} Migration SQL creates expiresAt index"
    PASS=$((PASS + 1))
else
    echo "${RED}✗${NC} Migration SQL does NOT create expiresAt index"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Verification Results                                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Passed: ${GREEN}${PASS}${NC}"
echo "Failed: ${RED}${FAIL}${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "${GREEN}✓ All checks passed! Migration setup is complete.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Commit changes to version control"
    echo "  2. Deploy using: docker-compose up -d"
    echo "  3. Monitor logs: docker logs -f golradar-app"
    echo "  4. Verify table: SELECT * FROM \"CronLock\";"
    exit 0
else
    echo "${RED}✗ Some checks failed. Please review the issues above.${NC}"
    exit 1
fi
