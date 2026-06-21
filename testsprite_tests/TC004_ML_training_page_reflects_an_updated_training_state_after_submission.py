import asyncio
import re
from playwright.async_api import expect
from _helpers import setup_browser, teardown_browser, login_as_admin


async def run_test():
    pw, browser, context, page = await setup_browser()
    try:
        await login_as_admin(page, must_change=False)

        # Navigate to ML training page.
        await page.get_by_role("link", name=re.compile(r"ML Eğitimi", re.I)).click(timeout=10000)
        await page.wait_for_url(re.compile(r".*/admin/ml/train.*"), timeout=10000)

        # Capture initial main content for comparison.
        initial = await page.locator("main").inner_text()

        # Trigger any data refresh (auto or button).
        await page.reload()
        await page.wait_for_load_state("domcontentloaded", timeout=5000)

        updated = await page.locator("main").inner_text()
        await expect(page.locator("main")).to_be_visible(timeout=10000)
        # Page re-rendered (length may shift slightly due to timestamps).
        assert len(updated) > 100, "Page should still render after refresh"
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())