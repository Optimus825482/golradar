import asyncio
import re
from playwright.async_api import expect
from _helpers import setup_browser, teardown_browser, login_as_admin


async def run_test():
    pw, browser, context, page = await setup_browser()
    try:
        await login_as_admin(page, must_change=False)

        await page.get_by_role("link", name=re.compile(r"Sinyal Backtest", re.I)).first.click(timeout=10000)
        await page.wait_for_url(re.compile(r".*/admin/signals/backtest.*"), timeout=10000)

        # Run default backtest, capture URL.
        table = page.locator("table")
        await table.wait_for(state="visible", timeout=15000)
        url_before = page.url
        assert url_before.endswith("/admin/signals/backtest"), f"Should be on backtest URL, got {url_before}"

        # Switch to Replay mode.
        await page.get_by_role("button", name=re.compile(r"Replay", re.I)).first.click()
        await page.get_by_role("button", name=re.compile(r"Backtest Başlat", re.I)).click()
        await page.wait_for_timeout(2000)
        assert page.url.endswith("/admin/signals/backtest"), "URL should remain after Replay switch"

        # Switch to 7g period.
        await page.get_by_role("button", name="7g", exact=True).click()
        await page.get_by_role("button", name=re.compile(r"Backtest Başlat", re.I)).click()
        await page.wait_for_timeout(2000)
        assert page.url.endswith("/admin/signals/backtest"), "URL should remain after period switch"

        # Page still rendering content.
        await expect(page.locator("main")).to_be_visible(timeout=10000)
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())