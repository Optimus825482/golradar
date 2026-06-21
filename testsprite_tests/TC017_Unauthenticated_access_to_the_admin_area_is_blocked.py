import asyncio
from playwright import async_api
from playwright.async_api import expect


async def run_test():
    pw = None
    browser = None
    context = None

    try:
        pw = await async_api.async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=["--window-size=1280,720", "--disable-dev-shm-usage",
                  "--ipc=host", "--single-process"],
        )
        context = await browser.new_context()
        context.set_default_timeout(15000)
        page = await context.new_page()

        # Navigate to protected admin route WITHOUT auth cookie
        await page.goto("http://localhost:3028/admin/ml")
        await page.wait_for_load_state("domcontentloaded", timeout=8000)

        # Middleware should redirect to /admin/login
        await page.wait_for_url("**/admin/login**", timeout=8000)

        # Verify login form is shown (not admin content)
        await page.get_by_placeholder("admin", exact=True).wait_for(state="visible", timeout=5000)

        # Verify admin sidebar is NOT visible
        sidebar = page.locator("aside")
        await expect(sidebar).not_to_be_visible(timeout=3000)

        # Verify login form elements are present
        await expect(page.get_by_placeholder("admin")).to_be_visible()
        await expect(page.get_by_placeholder("••••••")).to_be_visible()
        await expect(page.get_by_role("button", name="Giriş Yap")).to_be_visible()

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()


asyncio.run(run_test())
