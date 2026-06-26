import { expect, test } from "@playwright/test";

test("desktop hero keeps portrait clipped left and nav visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.locator(".hero-portrait img")).toBeVisible();

  const box = await page.locator(".hero-portrait").boundingBox();
  expect(box?.x).toBeLessThanOrEqual(0);
});

test("mobile keeps pill nav visible and omits selected work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByText("Selected Work")).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("line artwork is on a light section", async ({ page }) => {
  await page.goto("/");

  const bg = await page
    .locator(".about-artwork")
    .evaluate((node) => getComputedStyle(node.closest("section")!).backgroundColor);
  expect(["rgb(250, 250, 250)", "rgb(233, 232, 232)"]).toContain(bg);
});

test("contact html route renders the React form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/contact.html");

  await expect(page.getByRole("form", { name: "Project enquiry" })).toBeVisible();
  await expect(page.locator("input[name='access_key']")).toHaveValue("48578b9d-2262-418b-a5b9-4d9bd167ffb4");
});
