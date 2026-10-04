import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4173") return route.continue();
    if (
      url.hostname === "cdn.jsdelivr.net" &&
      url.pathname.includes("chart.js")
    ) {
      return route.fulfill({
        contentType: "application/javascript",
        body: "window.Chart = class { constructor(_ctx, config) { this.data = config.data; } update() {} destroy() {} };",
      });
    }
    if (
      url.hostname === "cdnjs.cloudflare.com" &&
      url.pathname.includes("three")
    ) {
      return route.fulfill({
        contentType: "application/javascript",
        body: "window.THREE = {};",
      });
    }
    if (url.hostname === "cdn.tailwindcss.com") {
      return route.fulfill({
        contentType: "application/javascript",
        body: 'document.head.insertAdjacentHTML("beforeend", "<style>.hidden{display:none}</style>");',
      });
    }
    return route.abort();
  });
});

test("page loads with all external dependencies intercepted", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#startBtn")).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.Chart && window.THREE))).toBe(
    true,
  );
});

test("quick mode runs to completion and reveals JSON export", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    MODE_SETTINGS.quick = {
      ...MODE_SETTINGS.quick,
      iterations: 1,
      cpuTime: 1,
      otherTime: 1,
      gpuTimeLimit: 1,
    };
    window.runCPUMultiCore = async () => 900;
    window.runStringTest = async () => 20;
    window.runRAMTest = async () => 700;
    window.runDOMTest = async () => 1000;
    window.runCanvas2DTest = async () => 15000;
    window.runThreeJSTest = async () => 750;
    window.runCryptoTest = async () => 3000;
    window.runStorageTest = async () => 3000;
    window.runNetworkTest = async () => ({
      value: 9000,
      dl: 9000,
      ul: 1000,
      ping: 10,
    });
  });
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/, {
    timeout: 15000,
  });
});
