import asyncio
from playwright.async_api import expect
from _helpers import setup_browser, teardown_browser, login_as_admin


async def run_test():
    pw, browser, context, page = await setup_browser()
    try:
        await login_as_admin(page, must_change=False)

        # Verify dashboard rendered: sidebar brand + nav items visible.
        sidebar = page.locator("aside")
        await expect(sidebar).to_be_visible(timeout=10000)
        await expect(page.get_by_role("link", name="Overview")).to_be_visible()
        await expect(page.get_by_role("link", name="ML Modelleri")).to_be_visible()
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())