import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("Scan a VIN barcode with the camera to fill the VIN", async ({ page }) => {
  // Stand in for the phone: a camera feed and a barcode reader that sees
  // an imported-vehicle door-jamb code (leading "I").
  await page.addInitScript(() => {
    class FakeDetector {
      async detect() {
        return [{ rawValue: "I1HGCM82633A004352" }];
      }
    }
    Object.assign(window, { BarcodeDetector: FakeDetector });
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream();
  });
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill("Vin");
  await page.getByLabel("Last name").fill(`TEST ${Date.now()}`);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  const scan = page.getByRole("button", { name: "📷 Scan VIN" });
  await expect(scan).toBeVisible();
  await auditUX(page, true);
  await scan.click();
  await expect(page.getByLabel("VIN", { exact: true })).toHaveValue(
    "1HGCM82633A004352",
  );
  await expect(
    page.getByRole("dialog", { name: "Scan the VIN barcode" }),
  ).toHaveCount(0);
});

test("No scan button where the browser can't read barcodes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  });
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/customers");
  await page.locator(".row-list a").first().click();
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await expect(page.getByLabel("VIN", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "📷 Scan VIN" })).toHaveCount(
    0,
  );
});
