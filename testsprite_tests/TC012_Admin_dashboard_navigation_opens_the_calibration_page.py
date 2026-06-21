import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        await page.goto("http://localhost:3028/")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Navigate to the admin login page by opening the '/admin' path (visit the application's Admin page).
        await page.goto("http://localhost:3028/admin")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill 'admin' into the 'Kullanıcı Adı' field, fill 'admin123' into the 'Şifre' field, and click the 'Giriş Yap' button to submit the login form.
        # admin text field
        elem = page.get_by_placeholder('admin', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("admin")
        
        # -> Fill 'admin' into the 'Kullanıcı Adı' field, fill 'admin123' into the 'Şifre' field, and click the 'Giriş Yap' button to submit the login form.
        # •••••• password field
        elem = page.get_by_placeholder('••••••', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("admin123")
        
        # -> Fill 'admin' into the 'Kullanıcı Adı' field, fill 'admin123' into the 'Şifre' field, and click the 'Giriş Yap' button to submit the login form.
        # Giriş Yap button
        elem = page.get_by_role('button', name='Giriş Yap', exact=True)
        await elem.click(timeout=10000)
        
        # -> Fill the Change Password modal by entering the current password, a new password (and confirmation), then click the 'Şifreyi Güncelle' button to submit the update.
        # password field
        elem = page.locator('xpath=/html/body/div[2]/main/div/div/form/div[2]/input')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("admin123")
        
        # -> Fill the Change Password modal by entering the current password, a new password (and confirmation), then click the 'Şifreyi Güncelle' button to submit the update.
        # En az 6 karakter password field
        elem = page.get_by_placeholder('En az 6 karakter', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("admin1234")
        
        # -> Fill the Change Password modal by entering the current password, a new password (and confirmation), then click the 'Şifreyi Güncelle' button to submit the update.
        # password field
        elem = page.locator('xpath=/html/body/div[2]/main/div/div/form/div[4]/input')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("admin1234")
        
        # -> Fill the Change Password modal by entering the current password, a new password (and confirmation), then click the 'Şifreyi Güncelle' button to submit the update.
        # Şifreyi Güncelle button
        elem = page.get_by_role('button', name='Şifreyi Güncelle', exact=True)
        await elem.click(timeout=10000)
        
        # -> Fill 'Mevcut Şifre' with 'admin123', fill 'Yeni Şifre' and 'Yeni Şifre (Tekrar)' with 'Admin1234!' and click the 'Şifreyi Güncelle' button to complete the mandatory password change so navigation is unblocked.
        # password field
        elem = page.locator('xpath=/html/body/div[2]/main/div/div/form/div[2]/input')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("admin123")
        
        # -> Fill 'Mevcut Şifre' with 'admin123', fill 'Yeni Şifre' and 'Yeni Şifre (Tekrar)' with 'Admin1234!' and click the 'Şifreyi Güncelle' button to complete the mandatory password change so navigation is unblocked.
        # password field
        elem = page.locator('xpath=/html/body/div[2]/main/div/div/form/div[4]/input')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Admin1234!")
        
        # -> Fill 'Mevcut Şifre' with 'admin123', fill 'Yeni Şifre' and 'Yeni Şifre (Tekrar)' with 'Admin1234!' and click the 'Şifreyi Güncelle' button to complete the mandatory password change so navigation is unblocked.
        # Şifreyi Güncelle button
        elem = page.get_by_role('button', name='Şifreyi Güncelle', exact=True)
        await elem.click(timeout=10000)
        
        # -> Fill the 'Mevcut Şifre' with 'admin123', enter the new password 'Admin1234!' into both 'Yeni Şifre' and 'Yeni Şifre (Tekrar)' fields, then click the 'Şifreyi Güncelle' button to complete the mandatory password change.
        # password field
        elem = page.locator('xpath=/html/body/div[2]/main/div/div/form/div[2]/input')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("admin123")
        
        # -> Fill the 'Mevcut Şifre' with 'admin123', enter the new password 'Admin1234!' into both 'Yeni Şifre' and 'Yeni Şifre (Tekrar)' fields, then click the 'Şifreyi Güncelle' button to complete the mandatory password change.
        # En az 6 karakter password field
        elem = page.get_by_placeholder('En az 6 karakter', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Admin1234!")
        
        # -> Fill the 'Mevcut Şifre' with 'admin123', enter the new password 'Admin1234!' into both 'Yeni Şifre' and 'Yeni Şifre (Tekrar)' fields, then click the 'Şifreyi Güncelle' button to complete the mandatory password change.
        # password field
        elem = page.locator('xpath=/html/body/div[2]/main/div/div/form/div[4]/input')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Admin1234!")
        
        # -> Fill the 'Mevcut Şifre' with 'admin123', enter the new password 'Admin1234!' into both 'Yeni Şifre' and 'Yeni Şifre (Tekrar)' fields, then click the 'Şifreyi Güncelle' button to complete the mandatory password change.
        # Şifreyi Güncelle button
        elem = page.get_by_role('button', name='Şifreyi Güncelle', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Kalibrasyon' navigation item in the left menu to see if navigation to the calibration page is allowed despite the mandatory 'Şifre Değiştir' modal.
        # 🎯 Kalibrasyon Brier score, drift, bucket analizi link
        elem = page.get_by_role('link', name='🎯 Kalibrasyon Brier score, drift, bucket analizi', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the calibration page is displayed
        # Assert: The browser is on the calibration page (URL contains /admin/calibration).
        await expect(page).to_have_url(re.compile("/admin/calibration"), timeout=15000), "The browser is on the calibration page (URL contains /admin/calibration)."
        await page.locator("xpath=/html/body/div[2]/main/div/div/div[1]/div[2]/button[1]").nth(0).scroll_into_view_if_needed()
        # Assert: The '7g' calibration period button is visible on the calibration page.
        await expect(page.locator("xpath=/html/body/div[2]/main/div/div/div[1]/div[2]/button[1]").nth(0)).to_be_visible(timeout=15000), "The '7g' calibration period button is visible on the calibration page."
        await page.locator("xpath=/html/body/div[2]/main/div/div/div[3]/div[2]/span[2]").nth(0).scroll_into_view_if_needed()
        # Assert: The 'Kalibre' metric label is visible on the calibration page.
        await expect(page.locator("xpath=/html/body/div[2]/main/div/div/div[3]/div[2]/span[2]").nth(0)).to_be_visible(timeout=15000), "The 'Kalibre' metric label is visible on the calibration page."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    