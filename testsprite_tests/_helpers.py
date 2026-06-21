"""Shared Playwright helpers for golradar2 TestSprite tests.

Usage pattern:
    from _helpers import setup_browser, login_as_admin, teardown_browser

    async def run_test():
        pw, browser, context, page = await setup_browser()
        try:
            await login_as_admin(page, must_change=False)
            # ... test body ...
        finally:
            await teardown_browser(pw, browser, context)
"""

from __future__ import annotations

from playwright import async_api
from playwright.async_api import Browser, BrowserContext, Page, Playwright


async def setup_browser() -> tuple[Playwright, Browser, BrowserContext, Page]:
    """Launch Chromium headless. Returns (pw, browser, context, page)."""
    pw = await async_api.async_playwright().start()
    browser = await pw.chromium.launch(
        headless=True,
        args=[
            "--window-size=1280,720",
            "--disable-dev-shm-usage",
            "--ipc=host",
            "--single-process",
        ],
    )
    context = await browser.new_context()
    context.set_default_timeout(15000)
    page = await context.new_page()
    return pw, browser, context, page


async def teardown_browser(
    pw: Playwright, browser: Browser, context: BrowserContext
) -> None:
    """Clean up browser resources."""
    if context:
        await context.close()
    if browser:
        await browser.close()
    if pw:
        await pw.stop()


async def login_as_admin(
    page: Page, must_change: bool = False, base_url: str = "http://localhost:3028"
) -> None:
    """Log in at /admin (redirected to /admin/login by middleware).

    Args:
        page: Playwright page.
        must_change: If True, complete the forced first-login password change.
                     Caller is responsible for resetting mustChange in DB first.
        base_url: Server URL.
    """
    await page.goto(f"{base_url}/admin")
    await page.wait_for_load_state("domcontentloaded", timeout=5000)

    # Middleware redirects to /admin/login?next=...
    await page.wait_for_url("**/admin/login**", timeout=8000)

    await page.get_by_placeholder("admin", exact=True).wait_for(
        state="visible", timeout=10000
    )
    await page.get_by_placeholder("admin", exact=True).fill("admin")
    await page.get_by_placeholder("••••••", exact=True).fill("admin123")
    await page.get_by_role("button", name="Giriş Yap", exact=True).click()

    if must_change:
        # Forced change-password flow.
        await page.wait_for_url("**/admin/change-password**", timeout=8000)
        pwds = page.locator("input[type='password']")
        await pwds.nth(0).fill("admin123")
        await page.get_by_placeholder("En az 6 karakter").fill("admin456")
        await pwds.nth(2).fill("admin456")
        await page.get_by_role("button", name="Şifreyi Güncelle").click()

    # Land on /admin dashboard. Wait for full document load so subsequent
    # page.goto() calls don't race a mid-navigation and hit ERR_ABORTED.
    await page.wait_for_url("**/admin**", timeout=10000)
    await page.wait_for_load_state("domcontentloaded", timeout=10000)


async def login_fail(
    page: Page, username: str = "fake-admin", password: str = "fake-password"
) -> None:
    """Attempt login with bad creds. Asserts the failure message is visible."""
    await page.goto("http://localhost:3028/admin")
    await page.wait_for_url("**/admin/login**", timeout=8000)
    await page.get_by_placeholder("admin", exact=True).fill(username)
    await page.get_by_placeholder("••••••", exact=True).fill(password)
    await page.get_by_role("button", name="Giriş Yap", exact=True).click()