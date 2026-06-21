import asyncio
import re
from playwright.async_api import expect
from _helpers import setup_browser, teardown_browser, login_as_admin


async def run_test():
    pw, browser, context, page = await setup_browser()
    try:
        await login_as_admin(page, must_change=False)

        # First "Algoritma" match is the sidebar nav; Signals Backtest description
        # also contains "Algoritma". nth(1) targets the sidebar link.
        link = page.get_by_role("link", name=re.compile(r"Algoritma", re.I)).nth(1)
        await link.click(timeout=10000)
        await page.wait_for_url(re.compile(r".*/admin/algorithm.*"), timeout=10000)
        await expect(page.locator("main")).to_be_visible(timeout=10000)
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())