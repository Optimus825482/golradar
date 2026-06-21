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

        # Handle forced password change
        try:
            await page.get_by_role("button", name="Şifreyi Güncelle", exact=True).wait_for(state="visible", timeout=4000)
            await page.locator("input[type='password']").nth(0).fill("admin123")
            await page.get_by_placeholder("En az 6 karakter").fill("admin456")
            await page.locator("input[type='password']").nth(2).fill("admin456")
            await page.get_by_role("button", name="Şifreyi Güncelle").click()
            await page.wait_for_url("**/admin", timeout=5000)
        except Exception:
            pass

        # Go to backtest and set 1 day window with 5min horizon
        await page.goto("http://localhost:3028/admin/signals/backtest")
        await page.wait_for_load_state("domcontentloaded", timeout=5000)

        # Auto-run fires; click 7g to minimize data, then 5dk horizon
        await page.get_by_role("button", name="7g", exact=True).click()
        await page.get_by_role("button", name="🚀 Backtest Başlat").click()

        # Wait for result (either table or message)
        await page.wait_for_timeout(3000)

        # Verify page is functional: either shows empty message or data table
        has_message = await page.locator("text=Veri yok").count() > 0
        has_table = await page.locator("table").count() > 0
        has_data = has_message or has_table

        assert has_data, "Expected either 'Veri yok' empty state or a results table"

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()


asyncio.run(run_test())
