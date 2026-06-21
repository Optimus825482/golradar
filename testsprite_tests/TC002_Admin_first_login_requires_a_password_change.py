import asyncio
import re
import subprocess
import os
from playwright.async_api import expect
from _helpers import setup_browser, teardown_browser


async def run_test():
    # Force mustChangePassword=true so login redirects to change-password page.
    env = dict(os.environ)
    env["PGPASSWORD"] = "518518Erkan"
    subprocess.run(
        ["psql", "-h", "localhost", "-U", "postgres", "-d", "golradar_db",
         "-c", "UPDATE \"User\" SET \"mustChangePassword\" = true WHERE username = 'admin';"],
        check=True, env=env, stdout=subprocess.DEVNULL
    )

    pw, browser, context, page = await setup_browser()
    try:
        await page.goto("http://localhost:3028/admin")
        await page.wait_for_url(re.compile(r".*/admin/login.*"), timeout=8000)
        await page.get_by_placeholder("admin", exact=True).fill("admin")
        await page.get_by_placeholder("••••••", exact=True).fill("admin123")
        await page.get_by_role("button", name="Giriş Yap", exact=True).click()
        # Must redirect to change-password page.
        await page.wait_for_url(re.compile(r".*/admin/change-password.*"), timeout=10000)
        await expect(
            page.get_by_role("heading", name=re.compile("Şifre Değiştir"))
        ).to_be_visible(timeout=5000)
    finally:
        await teardown_browser(pw, browser, context)
        # TC002 doesn't actually change the password (only tests redirect to
        # change-password page). Just clear mustChange so subsequent tests pass.
        subprocess.run(
            ["psql", "-h", "localhost", "-U", "postgres", "-d", "golradar_db",
             "-c", "UPDATE \"User\" SET \"mustChangePassword\" = false WHERE username = 'admin';"],
            check=False, env=env, stdout=subprocess.DEVNULL
        )


asyncio.run(run_test())