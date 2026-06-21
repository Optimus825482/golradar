
# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** golradar2 (Next.js 16 + Bun + Prisma admin dashboard)
- **Date:** 2026-06-20
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

### Requirement: Admin Authentication
- **Description:** PBKDF2 username/password auth, session tokens, forced first-login password change.

#### Test TC001 Admin login grants access to the dashboard
- **Test Code:** [TC001_Admin_login_grants_access_to_the_dashboard.py](./TC001_Admin_login_grants_access_to_the_dashboard.py)
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** POST `/api/admin/auth` with `admin/admin123` returns 200 + token. Dashboard renders. Verified directly via curl during testing.

#### Test TC002 Admin first login requires a password change
- **Test Code:** [TC002_Admin_first_login_requires_a_password_change.py](./TC002_Admin_first_login_requires_a_password_change.py)
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** Login response includes `mustChange:true`. `seedDefaultAdmin` in `src/lib/auth.ts:89-115` sets `mustChangePassword:true` on creation. API behavior verified.

#### Test TC016 Invalid admin login shows a failure message
- **Test Code:** [TC016_Invalid_admin_login_shows_a_failure_message.py](./TC016_Invalid_admin_login_shows_a_failure_message.py)
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** Wrong password → `{"ok":false,"reason":"invalid credentials"}` 401. Error surface works.

#### Test TC017 Unauthenticated access to the admin area is blocked
- **Test Code:** [TC017_Unauthenticated_access_to_the_admin_area_is_blocked.py](./TC017_Unauthenticated_access_to_the_admin_area_is_blocked.py)
- **Status:** ❌ Failed
- **Severity:** CRITICAL
- **Analysis / Findings:** CRITICAL auth bypass. `src/app/admin/layout.tsx` has NO auth guard — any unauthenticated user can hit `/admin`, `/admin/ml`, `/admin/ml/train`, etc. and view the full admin UI. Middleware (`src/middleware.ts`) only targets `/_next/static/chunks/`, not `/admin/*`. Fix: add server-side session check in `AdminLayout` (`src/app/admin/layout.tsx`) or middleware matcher covering `/admin/:path*`.

#### Test TC018 See an empty state when no signals backtest data matches the filters
- **Test Code:** [TC018_See_an_empty_state_when_no_signals_backtest_data_matches_the_filters.py](./TC018_See_an_empty_state_when_no_signals_backtest_data_matches_the_filters.py)
- **Status:** ⚠️ Blocked
- **Severity:** MEDIUM
- **Analysis / Findings:** Test expected a `/login` route. None exists — `src/app/login/` directory missing. Admin login is implemented as an in-page modal triggered inside `/admin`, not a separate route. Test scope mismatch; product works as designed but test design assumed `/login`.

---

### Requirement: Admin Navigation
- **Description:** Sidebar/topbar nav across 11 admin pages.

#### Test TC005 Open signals backtest page
- **Test Code:** [TC005_Admin_dashboard_navigation_opens_the_signals_backtest_page.py](./TC005_Admin_dashboard_navigation_opens_the_signals_backtest_page.py)
- **Status:** ✅ Passed
- **Severity:** LOW

#### Test TC007 Open ML overview page
- **Test Code:** [TC007_Admin_dashboard_navigation_opens_the_ML_overview_page.py](./TC007_Admin_dashboard_navigation_opens_the_ML_overview_page.py)
- **Status:** ✅ Passed
- **Severity:** LOW

#### Test TC011 Open algorithm page
- **Test Code:** [TC011_Admin_dashboard_navigation_opens_the_algorithm_page.py](./TC011_Admin_dashboard_navigation_opens_the_algorithm_page.py)
- **Status:** ✅ Passed
- **Severity:** LOW

#### Test TC012 Open calibration page
- **Test Code:** [TC012_Admin_dashboard_navigation_opens_the_calibration_page.py](./TC012_Admin_dashboard_navigation_opens_the_calibration_page.py)
- **Status:** ✅ Passed
- **Severity:** LOW

#### Test TC013 Open Elo page
- **Test Code:** [TC013_Admin_dashboard_navigation_opens_the_Elo_page.py](./TC013_Admin_dashboard_navigation_opens_the_Elo_page.py)
- **Status:** ✅ Passed
- **Severity:** LOW

---

### Requirement: ML Training
- **Description:** ML training page showing status + triggering training runs.

#### Test TC003 ML training page shows status and starts a training run
- **Test Code:** [TC003_ML_training_page_shows_status_and_starts_a_training_run.py](./TC003_ML_training_page_shows_status_and_starts_a_training_run.py)
- **Status:** ⚠️ Blocked
- **Severity:** HIGH
- **Analysis / Findings:** Frontend forced 'Şifre Değiştir' (Change Password) modal blocks navigation. Modal submission returns `unknown action` error. Root cause: modal posts `action` value that doesn't match server-accepted enum. Backend POST `/api/admin/auth` with `action: "change-password"` works correctly (verified — returned `{"ok":true}` then login with new password succeeded, mustChange=false). The bug is client-side: the modal's submit handler sends the wrong action string to the API. Inspect `src/app/admin` change-password modal component.

#### Test TC004 ML training page reflects an updated training state after submission
- **Test Code:** [TC004_ML_training_page_reflects_an_updated_training_state_after_submission.py](./TC004_ML_training_page_reflects_an_updated_training_state_after_submission.py)
- **Status:** ⚠️ Blocked
- **Severity:** HIGH
- **Analysis / Findings:** Same root cause as TC003 — blocked by password-change modal bug.

---

### Requirement: Signals Backtest
- **Description:** View historical signal performance with date/horizon filters.

#### Test TC006 View the default signals backtest results
- **Test Code:** [TC006_View_the_default_signals_backtest_results.py](./TC006_View_the_default_signals_backtest_results.py)
- **Status:** ❌ Failed
- **Severity:** MEDIUM
- **Analysis / Findings:** Page renders controls but no default historical results shown — no `<table>` elements present. The 'Geçmiş' section is missing or rendered only after explicit 'Backtest Başlat'. Functional omission: backtest viewer should auto-load latest run on mount.

#### Test TC008 Filter signals backtest results by date
- **Test Code:** [TC008_Filter_signals_backtest_results_by_date.py](./TC008_Filter_signals_backtest_results_by_date.py)
- **Status:** ❌ Failed
- **Severity:** MEDIUM
- **Analysis / Findings:** Selecting 7-day period + Backtest Başlat → red 'Backtest başarısız' banner, no results. Likely API `POST /api/admin/signals/backtest` returns error or `GET` with period filter fails. Check `src/app/api/admin/signals/backtest/route.ts`.

#### Test TC009 Filter signals backtest results by horizon
- **Test Code:** [TC009_Filter_signals_backtest_results_by_horizon.py](./TC009_Filter_signals_backtest_results_by_horizon.py)
- **Status:** ❌ Failed
- **Severity:** MEDIUM
- **Analysis / Findings:** Same pattern as TC008. Horizon parameter not accepted or query path broken.

#### Test TC010 Update both signals backtest filters in one session
- **Test Code:** [TC010_Update_both_signals_backtest_filters_in_one_session.py](./TC010_Update_Update_both_signals_backtest_filters_in_one_session.py)
- **Status:** ⚠️ Blocked
- **Severity:** MEDIUM
- **Analysis / Findings:** Blocked by same password-change modal bug as TC003/TC004.

#### Test TC014 Keep signals backtest results usable after changing filters repeatedly
- **Test Code:** [TC014_Keep_signals_backtest_results_usable_after_changing_filters_repeatedly.py](./TC014_Keep_signals_backtest_results_usable_after_changing_filters_repeatedly.py)
- **Status:** ⚠️ Blocked
- **Severity:** LOW
- **Analysis / Findings:** Blocked because test expected `/login` route. After TC018 fix, this test should re-run cleanly.

#### Test TC015 Stay on the signals backtest page while switching filters
- **Test Code:** [TC015_Stay_on_the_signals_backtest_page_while_switching_filters.py](./TC015_Stay_on_the_signals_backtest_page_while_switching_filters.py)
- **Status:** ❌ Failed
- **Severity:** MEDIUM
- **Analysis / Findings:** Persistent 'Backtest başarısız' across mode/period combinations. Same API error as TC008/TC009.

---

## 3️⃣ Coverage & Matching Metrics

**44.4% of tests passed fully** (8/18). 5 failed, 5 blocked.

| Requirement              | Total Tests | ✅ Passed | ❌ Failed | ⚠️ Blocked |
|--------------------------|-------------|-----------|-----------|------------|
| Admin Authentication     | 5           | 3         | 1         | 1          |
| Admin Navigation         | 5           | 5         | 0         | 0          |
| ML Training              | 2           | 0         | 0         | 2          |
| Signals Backtest         | 6           | 0         | 4         | 2          |
| **Total**                | **18**      | **8**     | **5**     | **5**      |

---

## 4️⃣ Key Gaps / Risks

**🚨 CRITICAL — Auth bypass (TC017):**
`/admin/*` routes have no server-side auth guard. `src/middleware.ts:26` only matches `/_next/static/chunks/:path*`. Any unauthenticated user can read the full admin UI (model cards, training triggers, signals data). Fix: add `/admin/:path*` matcher + `validateSession` check, OR guard in `src/app/admin/layout.tsx` server component.

**🔴 HIGH — Password-change modal broken (TC003/TC004/TC010):**
Frontend modal posts wrong `action` value to `/api/admin/auth` — server returns `unknown action` 400. Backend API itself works correctly (verified via direct curl). Bug is in the client modal submit handler. Locate and fix action string in the change-password component.

**🟠 MEDIUM — Signals backtest endpoint (TC006/008/009/015):**
'Backtest başarısız' on date/horizon filter changes. No default historical results on mount. Inspect `src/app/api/admin/signals/backtest/route.ts` — likely missing default result fetch or filter param handling.

**🟡 MEDIUM — Missing `/login` route (TC014/TC018):**
No `src/app/login/` route exists. Admin login is in-page modal at `/admin`. Either add `/login` page or update tests to match product design (trigger modal from `/admin` directly).

**📊 Operational note from server boot:**
ML in-play retrain skipped — `ML_TRAINER_URL` not set. 5/10/15-min horizon exports running fine. Not test-blocking but limits coverage of in-play ML training paths.

---

**Action priority:**
1. Fix `/admin` auth guard (CRITICAL — 1-line fix in middleware matcher + redirect)
2. Fix change-password modal action string (HIGH — unblocks 3 tests)
3. Fix signals backtest API filter handling (MEDIUM — unblocks 4 tests)
4. Decide on `/login` route existence (MEDIUM — scope/test design)
