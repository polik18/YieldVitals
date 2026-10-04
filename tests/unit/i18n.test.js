import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const localeJsonDir = new URL("../../locales/", import.meta.url);
const localeScriptDir = new URL("../../js/locales/", import.meta.url);
const englishRadarOrder = [
  "Compute (CPU)",
  "Compute (String)",
  "Compute (Crypto)",
  "Memory (RAM)",
  "Storage (Local)",
  "Graphics (DOM)",
  "Graphics (GPU)",
  "Graphics (2D)",
];

describe("locale resources", () => {
  it("parses all 30 JSON locale files and retains eight radar labels", async () => {
    const files = (await readdir(localeJsonDir)).filter((file) =>
      file.endsWith(".json"),
    );
    expect(files).toHaveLength(30);
    for (const file of files) {
      const data = JSON.parse(
        await readFile(new URL(file, localeJsonDir), "utf8"),
      );
      expect(data.radar_labels, file).toHaveLength(8);
    }
  });

  it("loads all 30 classic-script locales with the same eight-axis order", async () => {
    const files = (await readdir(localeScriptDir)).filter((file) =>
      file.endsWith(".js"),
    );
    expect(files).toHaveLength(30);
    for (const file of files) {
      const context = { window: {} };
      vm.runInNewContext(
        await readFile(new URL(file, localeScriptDir), "utf8"),
        context,
        { filename: file },
      );
      const locale = context.window.YIELDVITALS_LOCALES?.[file.slice(0, -3)];
      expect(locale, file).toBeTruthy();
      if (locale?.radar_labels) expect(locale.radar_labels).toHaveLength(8);
    }
    const english = JSON.parse(
      await readFile(new URL("en.json", localeJsonDir), "utf8"),
    );
    expect(english.radar_labels).toEqual(englishRadarOrder);
  });
});
