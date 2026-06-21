import asyncio
import re
from playwright.async_api import expect
from _helpers import setup_browser, teardown_browser, login_fail


async def run_test():
    pw, browser, context, page = await setup_browser()
    try:
        await login_fail(page, username="fake-admin", password="fake-password")

        # Verify error message rendered.
        await expect(page.get_by_text(re.compile(r"invalid credentials|başarısız", re.I))).to_be_visible(
            timeout=10000
        )
    finally:
        await teardown_browser(pw, browser, context)


asyncio.run(run_test())