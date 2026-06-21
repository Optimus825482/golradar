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

        # Login
        await page.goto("http://localhost:3028/admin/login")
        await page.wait_for_load_state("domcontentloaded", timeout=5000)
        await page.get_by_placeholder("admin", exact=True).fill("admin")
        await page.get_by_placeholder("••••••", exact=True).fill("admin123")
        await page.get_by_role("button", name="Giriş Yap", exact=True).click()

        # Handle forced password change if it appears
        try:
            await page.get_by_role("button", name="Şifreyi Güncelle", exact=True).wait_for(state="visible", timeout=4000)
            await page.locator("input[type='password']").nth(0).fill("admin123")
            await page.get_by_placeholder("En az 6 karakter").fill("admin456")
            await page.locator("input[type='password']").nth(2).fill("admin456")
            await page.get_by_role("button", name="Şifreyi Güncelle").click()
            await page.wait_for_url("**/admin", timeout=5000)
        except Exception:
            pass

        # Navigate to backtest
        await page.goto("http://localhost:3028/admin/signals/backtest")
        await page.wait_for_load_state("domcontentloaded", timeout=5000)

        # Auto-run fires on mount; wait for results table to appear
        table = page.locator("table")
        await table.wait_for(state="visible", timeout=10000)

        # Assertions
        await expect(table).to_be_visible()
        await expect(table.locator("tbody tr")).to_have_count(10)  # 10 buckets in bucket mode

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()


asyncio.run(run_test())
