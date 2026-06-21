import asyncio
import re
from playwright.async_api import expect
from _helpers import setup_browser, teardown_browser, login_as_admin


async def run_test():
    pw, browser, context, page = await setup_browser()
    try:
        await login_as_admin(page, must_change=False)

        # Click the Signals Backtest sidebar nav item.
        link = page.get_by_role("link", name=re.compile(r"Sinyal Backtest", re.I))
        await link.click(timeout=10000)
        await page.wait_for_url(re.compile(r".*/admin/signals/backtest.*"), timeout=10000)

        # Verify the Backtest Başlat button is visible.
        await expect(
            page.get_by_role("button", name=re.compile(r"Backtest Başlat", re.I))
        ).to_be_visible(timeout=10000)
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())