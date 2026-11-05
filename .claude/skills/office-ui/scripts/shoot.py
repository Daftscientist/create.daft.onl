# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright==1.60.0"]
# ///
"""Capture UI states for review: references from the web, or our own dev server.

usage: uv run shoot.py <plan.json> <out_dir>

plan.json is a list of shots:
  {"id": "home-desktop-light", "url": "http://localhost:5173/",
   "device": "desktop" | "mobile",            # 1440x900@1 or 390x844@2 touch
   "theme": "light" | "dark",                 # prefers-color-scheme
   "reduced_motion": false,
   "element": "css selector",                 # optional: clip to one element
   "ready": "css selector",                   # optional: wait for this before steps (e.g. "aside", "main")
   "steps": [["wait", 800], ["hover", "sel"], ["click", "sel"], ["press", "Meta+K"],
             ["scroll", 600], ["drag", "from-sel", "to-sel"], ["longpress", "sel"],
             ["eval", "js"]]}

Steps run in order, then the shot is taken. A failed step marks the shot FAIL rather than
silently capturing the wrong state.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import Page, async_playwright

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)


async def step(page: Page, s: list) -> None:
    kind, *args = s
    if kind == "wait":
        await page.wait_for_timeout(args[0])
    elif kind == "hover":
        await page.hover(args[0])
    elif kind == "click":
        await page.click(args[0])
    elif kind == "press":
        await page.keyboard.press(args[0])
    elif kind == "scroll":
        await page.mouse.wheel(0, args[0])
        await page.wait_for_timeout(400)
    elif kind == "drag":
        await page.drag_and_drop(args[0], args[1])
    elif kind == "longpress":
        box = await page.locator(args[0]).first.bounding_box()
        assert box, f"no box for {args[0]}"
        await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        await page.mouse.down()
        await page.wait_for_timeout(650)
    elif kind == "eval":
        await page.evaluate(args[0])
    else:
        raise ValueError(f"unknown step {kind}")


async def shoot(browser, shot: dict, out: Path, sem: asyncio.Semaphore) -> None:
    mobile = shot.get("device") == "mobile"
    async with sem:
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900},
            device_scale_factor=2 if mobile else 1,
            is_mobile=mobile,
            has_touch=mobile,
            user_agent=MOBILE_UA if mobile else None,
            color_scheme=shot.get("theme", "light"),
            reduced_motion="reduce" if shot.get("reduced_motion") else "no-preference",
        )
        page = await ctx.new_page()
        try:
            await page.goto(shot["url"], wait_until="networkidle", timeout=30000)
            if ready := shot.get("ready"):
                await page.wait_for_selector(ready, timeout=20000)
            await page.wait_for_timeout(600)
            for s in shot.get("steps", []):
                await step(page, s)
            await page.wait_for_timeout(350)  # let springs settle
            path = out / f"{shot['id']}.png"
            if sel := shot.get("element"):
                await page.locator(sel).first.screenshot(path=path)
            else:
                await page.screenshot(path=path)
            print(f"ok   {path}")
        except Exception as e:  # report and keep going; the caller decides
            print(f"FAIL {shot['id']}: {str(e).splitlines()[0][:160]}")
        finally:
            await ctx.close()


async def main() -> None:
    plan = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        sem = asyncio.Semaphore(4)
        await asyncio.gather(*(shoot(browser, s, out, sem) for s in plan))
        await browser.close()


asyncio.run(main())
