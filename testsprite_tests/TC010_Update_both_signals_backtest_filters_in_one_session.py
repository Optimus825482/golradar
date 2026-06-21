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

        table = page.locator("table")
        await table.wait_for(state="visible", timeout=15000)

        # Apply both filters: period 7g + horizon 15dk.
        await page.get_by_role("button", name="7g", exact=True).click()
        await page.get_by_role("button", name="15dk", exact=True).click()
        await page.get_by_role("button", name=re.compile(r"Backtest Başlat", re.I)).click()
        await table.wait_for(state="visible", timeout=15000)
        await expect(table).to_be_visible()
        await expect(table.locator("tbody tr")).to_have_count(10)
        assert page.url.endswith("/admin/signals/backtest"), f"Should stay on backtest URL, got {page.url}"
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())