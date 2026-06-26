import { expect, test } from "@playwright/test";

const routes = ["/", "/contact.html", "/thank-you.html"] as const;
const auditViewports = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 }
] as const;

function watchPageFailures(page: import("@playwright/test").Page) {
  const problems: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`page error: ${error.message}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === "http://127.0.0.1:4173" && response.status() >= 400) {
      problems.push(`failed response ${response.status()}: ${url.pathname}`);
    }
  });

  return problems;
}

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

test("tablet hero keeps portrait clear of headline and actions", async ({ page }) => {
  for (const width of [768, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const metrics = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        const box = element?.getBoundingClientRect();
        return box
          ? {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom
            }
          : null;
      };
      const intersects = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
        Boolean(a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom));
      const portrait = rect(".hero-portrait img");
      const textBoxes = [rect(".hero h1"), rect(".hero-title"), rect(".hero-tagline"), rect(".hero-actions")];

      return {
        hasPortraitTextOverlap: textBoxes.some((box) => intersects(portrait, box)),
        hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });

    expect(metrics.hasPortraitTextOverlap).toBe(false);
    expect(metrics.hasHorizontalOverflow).toBe(false);
  }
});

test("home sections reveal as the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  for (const selector of ["#services", "#about", "#experience"]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await expect(page.locator(selector)).toHaveClass(/(?:^|\s)in(?:\s|$)/);
    await expect(page.locator(selector)).toBeVisible();
  }
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

test("all public routes load without console errors or broken local assets", async ({ page }) => {
  const problems = watchPageFailures(page);

  for (const route of routes) {
    await page.goto(route, { waitUntil: "networkidle" });

    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("script[data-testid='person-json-ld']")).toHaveCount(1);

    const imageFailures = await page.locator("img").evaluateAll((images) =>
      images
        .filter((image) => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0)
        .map((image) => image.getAttribute("src"))
    );

    expect(imageFailures).toEqual([]);
    expect(problems).toEqual([]);
  }
});

test("rendered pages do not expose mojibake characters", async ({ page }) => {
  for (const route of routes) {
    await page.goto(route, { waitUntil: "networkidle" });

    const bodyText = await page.locator("body").innerText();
    expect(bodyText, `${route} contains mojibake`).not.toMatch(/[Â�]|â[€\u0080-\u00bf]/);
  }
});

test("home navigation reaches every section and content is visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  for (const [label, selector] of [
    ["Services", "#services"],
    ["About", "#about"],
    ["Experience", "#experience"],
    ["Skills", "#skills"],
    ["Contact", "#contact"]
  ] as const) {
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label }).click();
    await expect(page.locator(selector)).toBeInViewport({ ratio: 0.2 });
    await expect(page.locator(selector)).toHaveClass(/(?:^|\s)in(?:\s|$)/);
  }
});

test("responsive pages avoid horizontal overflow and keep primary content visible", async ({ page }) => {
  for (const viewport of auditViewports) {
    await page.setViewportSize(viewport);

    for (const route of routes) {
      await page.goto(route, { waitUntil: "networkidle" });

      const metrics = await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        const heading = document.querySelector("h1")?.getBoundingClientRect();
        return {
          hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          mainHeight: main?.height ?? 0,
          headingWidth: heading?.width ?? 0,
          viewportWidth: document.documentElement.clientWidth
        };
      });

      expect(metrics.hasHorizontalOverflow, `${route} overflows at ${viewport.width}px`).toBe(false);
      expect(metrics.mainHeight, `${route} has no visible page body at ${viewport.width}px`).toBeGreaterThan(200);
      expect(metrics.headingWidth, `${route} heading is wider than viewport at ${viewport.width}px`).toBeLessThanOrEqual(
        metrics.viewportWidth
      );
    }
  }
});

test("contact form has valid Web3Forms wiring and usable fields", async ({ page }) => {
  await page.goto("/contact.html");

  const form = page.getByRole("form", { name: "Project enquiry" });
  await expect(form).toHaveAttribute("method", "POST");
  await expect(form).toHaveAttribute("action", "https://api.web3forms.com/submit");
  await expect(page.locator("input[name='redirect']")).toHaveValue("https://mojtabakeivanlou.com/thank-you.html");
  await expect(page.locator("input[name='subject']")).toHaveValue("New Project Enquiry - mojtabakeivanlou.com");
  await expect(page.locator("input[name='Received (Oman Time)']")).not.toHaveValue("");

  await page.locator("input[name='name']").fill("Test User");
  await page.locator("input[name='email']").fill("test@example.com");
  await page.locator("input[name='phone']").fill("+968 9000 0000");
  await page.locator("input[name='organisation']").fill("Hydraulic Test Office");
  await page.locator("select[name='project-type']").selectOption({ label: "Flood Protection and Hazard Mapping" });
  await page.locator("textarea[name='description']").fill("Testing the project enquiry form wiring and field usability.");

  const isValid = await page.locator("form").evaluate((formElement) => (formElement as HTMLFormElement).checkValidity());
  expect(isValid).toBe(true);
});

test("thank-you page recovery links route to real destinations", async ({ page }) => {
  await page.goto("/thank-you.html");

  await expect(page.getByRole("heading", { name: "Enquiry Received" })).toBeVisible();

  for (const name of ["Back to Home", "Send Another", "Download CV"]) {
    const href = await page.getByRole("link", { name }).getAttribute("href");
    expect(href, `${name} should have a destination`).toBeTruthy();
  }

  await page.getByRole("link", { name: "Send Another" }).click();
  await expect(page.getByRole("form", { name: "Project enquiry" })).toBeVisible();
});

test("visual tokens and hero type scale stay within intended ranges", async ({ page }) => {
  await page.goto("/");

  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      green: styles.getPropertyValue("--color-green").trim(),
      ink: styles.getPropertyValue("--color-ink").trim(),
      lime: styles.getPropertyValue("--color-lime").trim(),
      paper: styles.getPropertyValue("--color-paper").trim()
    };
  });
  expect(tokens).toEqual({
    green: "#1a5241",
    ink: "#18231d",
    lime: "#bfdb39",
    paper: "#fafafa"
  });

  for (const viewport of [
    { width: 390, height: 844, min: 35, max: 48 },
    { width: 900, height: 900, min: 74, max: 86 },
    { width: 1440, height: 1000, min: 120, max: 132 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const fontSize = await page.locator(".hero h1").evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(viewport.min);
    expect(fontSize).toBeLessThanOrEqual(viewport.max);
  }
});
