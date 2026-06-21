
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** golradar2
- **Date:** 2026-06-20
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 Admin login grants access to the dashboard
- **Test Code:** [TC001_Admin_login_grants_access_to_the_dashboard.py](./TC001_Admin_login_grants_access_to_the_dashboard.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/775a7320-2f27-4b91-8489-2d3834f54fb8
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 Admin first login requires a password change
- **Test Code:** [TC002_Admin_first_login_requires_a_password_change.py](./TC002_Admin_first_login_requires_a_password_change.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/eace3999-c204-42fd-b836-14d73b1b93b6
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 ML training page shows status and starts a training run
- **Test Code:** [TC003_ML_training_page_shows_status_and_starts_a_training_run.py](./TC003_ML_training_page_shows_status_and_starts_a_training_run.py)
- **Test Error:** TEST BLOCKED

The test could not be run — the admin forced password-change flow failed with a server error and prevented access to the admin pages.

Observations:
- After successful login, the forced 'Şifre Değiştir' modal remained visible and showed the error message 'unknown action'.
- Clicking 'Şifreyi Güncelle' did not dismiss the modal or navigate to the admin content; the change-password submission returned the same error.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/1892d348-f019-4313-97ca-d2fedd65b7f0
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 ML training page reflects an updated training state after submission
- **Test Code:** [TC004_ML_training_page_reflects_an_updated_training_state_after_submission.py](./TC004_ML_training_page_reflects_an_updated_training_state_after_submission.py)
- **Test Error:** TEST BLOCKED

The test could not be run — the required initial password change cannot be completed through the UI, which prevents access to the ML training page.

Observations:
- The password-change modal remains open and displays the error message 'unknown action' after submitting matching new passwords.
- The modal blocks access to the admin navigation (including the 'ML Eğitimi' link) and there is no visible way to bypass or cancel the modal.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/efe58f1d-ec26-4f20-a01e-709f2b3540f2
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 Admin dashboard navigation opens the signals backtest page
- **Test Code:** [TC005_Admin_dashboard_navigation_opens_the_signals_backtest_page.py](./TC005_Admin_dashboard_navigation_opens_the_signals_backtest_page.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/7adbfd98-beae-4671-8b6e-dcdaefe5e293
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006 View the default signals backtest results
- **Test Code:** [TC006_View_the_default_signals_backtest_results.py](./TC006_View_the_default_signals_backtest_results.py)
- **Test Error:** TEST FAILURE

Historical backtest results are not shown by default when an authenticated admin opens the Sinyal Algoritması Backtest page.

Observations:
- The page displays backtest controls (mode, period) and a prominent '🚀 Backtest Başlat' button but no historical results or results table are visible.
- Multiple DOM searches and page inspections returned zero <table> elements and no visible 'Geçmiş' section or historical results content.
- Admin authentication succeeded (admin/admin123 reached the backtest page), so the missing historical results appear to be a functional omission rather than an authentication/blocking issue.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/bbfe7d27-d3bb-4cb6-84a2-8654ba1388b1
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 Admin dashboard navigation opens the ML overview page
- **Test Code:** [TC007_Admin_dashboard_navigation_opens_the_ML_overview_page.py](./TC007_Admin_dashboard_navigation_opens_the_ML_overview_page.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/ac33221f-cc9d-4998-9d0b-e51be6e1d9e9
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 Filter signals backtest results by date
- **Test Code:** [TC008_Filter_signals_backtest_results_by_date.py](./TC008_Filter_signals_backtest_results_by_date.py)
- **Test Error:** TEST FAILURE

The backtest did not produce updated results after selecting a different date range.

Observations:
- A red alert on the page shows the message 'Backtest başarısız' (Backtest failed).
- No backtest results table or metrics are visible in the main content area after starting the backtest.
- The 7-day period selection ('7g') is visibly selected in the UI, but results do not reflect that selection because the backtest failed.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/a4f171ae-2f5a-445b-8c3b-aeb8297f6aeb
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009 Filter signals backtest results by horizon
- **Test Code:** [TC009_Filter_signals_backtest_results_by_horizon.py](./TC009_Filter_signals_backtest_results_by_horizon.py)
- **Test Error:** TEST FAILURE

Running backtests for different horizons did not produce refreshed results — each attempt returned an error and no results table was shown.

Observations:
- After starting backtest for 7g, 30g, and 90g the page displayed the banner 'Backtest başarısız'.
- No backtest results table or refreshed metrics appeared in the backtest area after any attempt.
- Horizon buttons are present and selectable, but selecting them and clicking 'Backtest Başlat' did not return usable results.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/fcc893a0-dd84-4c11-8319-e3b06b9144f7
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010 Update both signals backtest filters in one session
- **Test Code:** [TC010_Update_both_signals_backtest_filters_in_one_session.py](./TC010_Update_both_signals_backtest_filters_in_one_session.py)
- **Test Error:** TEST BLOCKED

The test could not be run to completion because admin authentication is blocked by a persistent UI/backend error on the forced password-change form.

Observations:
- The 'Şifre Değiştir' (Change Password) dialog remains open after submission and shows a red 'unknown action' error beneath the form.
- Access to the admin dashboard and the 'Sinyal Backtest' page is blocked until the password-change completes.
- Multiple attempts to submit matching new passwords failed (several submissions, including matching passwords), so the change cannot be completed through the UI.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/68dfe0d8-f9e5-4acb-ae93-439df65e686c
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011 Admin dashboard navigation opens the algorithm page
- **Test Code:** [TC011_Admin_dashboard_navigation_opens_the_algorithm_page.py](./TC011_Admin_dashboard_navigation_opens_the_algorithm_page.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/cb8a1202-4a3e-4357-a849-d90449724a33
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012 Admin dashboard navigation opens the calibration page
- **Test Code:** [TC012_Admin_dashboard_navigation_opens_the_calibration_page.py](./TC012_Admin_dashboard_navigation_opens_the_calibration_page.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/f3c67a8a-d184-499d-9f72-45f4cfc9f69d
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013 Admin dashboard navigation opens the Elo page
- **Test Code:** [TC013_Admin_dashboard_navigation_opens_the_Elo_page.py](./TC013_Admin_dashboard_navigation_opens_the_Elo_page.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/27d88976-886b-4a31-999a-9ebe25ab5cce
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC014 Keep signals backtest results usable after changing filters repeatedly
- **Test Code:** [TC014_Keep_signals_backtest_results_usable_after_changing_filters_repeatedly.py](./TC014_Keep_signals_backtest_results_usable_after_changing_filters_repeatedly.py)
- **Test Error:** TEST BLOCKED

The test could not be run because the Login page is not accessible at /login, preventing authentication and all subsequent test steps.

Observations:
- Navigating to /login shows 'Sayfa Bulunamadı' (Page not found) with a central message card.
- The page only displays an 'Ana Sayfaya Dön' button and a notifications region; no username or password fields or login form elements are present.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/0f51dcaa-dd9b-4e20-afb7-89164ee0c445
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC015 Stay on the signals backtest page while switching filters
- **Test Code:** [TC015_Stay_on_the_signals_backtest_page_while_switching_filters.py](./TC015_Stay_on_the_signals_backtest_page_while_switching_filters.py)
- **Test Error:** TEST FAILURE

The backtest UI is reachable, but running backtests repeatedly failed and no results table was produced, so it was not possible to verify that switching filters preserves access to the results view.

Observations:
- The page showed a persistent 'Backtest başarısız' error after multiple run attempts.
- No backtest results table or result rows were displayed after any run.
- Changing mode to 'Replay' and period to '7g' (and other period selections) then starting the backtest still produced the failure banner.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/3fc5b9c0-e18a-49a3-888e-82b415c58c48
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC016 Invalid admin login shows a failure message
- **Test Code:** [TC016_Invalid_admin_login_shows_a_failure_message.py](./TC016_Invalid_admin_login_shows_a_failure_message.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/5075ed1f-048a-4fa3-9afe-6ca0838f05cc
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC017 Unauthenticated access to the admin area is blocked
- **Test Code:** [TC017_Unauthenticated_access_to_the_admin_area_is_blocked.py](./TC017_Unauthenticated_access_to_the_admin_area_is_blocked.py)
- **Test Error:** TEST FAILURE

Opening the protected admin route did not redirect to a sign-in screen — admin UI was exposed without authentication.

Observations:
- The page displays the "ML & Modeller" admin panel header and model cards (e.g., "GBDT (Champion)", "XGBoost", "InPlay 5dk").
- The left admin navigation/sidebar with links (Overview, ML Modelleri, ML Eğitimi, etc.) is visible, indicating the admin interface is loaded.
- No sign-in or login form is present on the page.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/7332eaf0-d026-4b5f-a023-7fb248daeadc
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC018 See an empty state when no signals backtest data matches the filters
- **Test Code:** [TC018_See_an_empty_state_when_no_signals_backtest_data_matches_the_filters.py](./TC018_See_an_empty_state_when_no_signals_backtest_data_matches_the_filters.py)
- **Test Error:** TEST BLOCKED

The Admin Login page could not be reached through the UI, so the test flow requiring authentication could not be executed.

Observations:
- Navigating to /login displayed a 'Sayfa Bulunamadı' (Page not found) message instead of an admin sign-in form.
- The page only offers an 'Ana Sayfaya Dön' (Return to Home) action and no visible login fields or links to reach the admin sign-in UI.

Because the required UI feature (admin login form at /login) is missing, the remaining steps (sign in, open Signals → Backtest, apply a restrictive date range, and verify empty state) cannot be performed. The test is blocked.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f0732bc4-b1b2-412a-90e4-834ff0041026/bc0822fc-fdd5-47ef-8d86-268f628a72f0
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **44.44** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---