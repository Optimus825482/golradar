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

        # Page must render — header + at least one status indicator or button.
        await expect(page.locator("main")).to_be_visible(timeout=10000)
        body_text = await page.locator("main").inner_text()
        assert len(body_text) > 100, "ML training page should render substantive content"
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())