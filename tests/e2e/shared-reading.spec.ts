import { expect, test, type Page } from "@playwright/test";

const DEMO_PASSWORD = "koala-demo-123";

async function openDemoPaper(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const groupLink = page.getByRole("link", { name: /Open Koala Lab/ });
  await expect(groupLink).toBeVisible();
  await groupLink.click();

  const paperLink = page
    .locator("aside")
    .getByRole("link", { name: /Attention Is All You Need/ });
  await expect(paperLink).toBeVisible();
  await paperLink.click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}\/p\/[0-9a-f-]{36}/);
  const firstPage = page.getByTestId("reader-page").first();
  await expect(firstPage).toBeVisible();
  await expect(firstPage).toHaveAttribute("data-map-ready", "true");
}

async function selectShortPhrase(page: Page) {
  const textLayer = page.getByTestId("reader-text-layer").first();
  await expect.poll(() => textLayer.locator("span").count()).toBeGreaterThan(0);
  const selectedText = await textLayer.evaluate((layer) => {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text;
      if ((candidate.nodeValue ?? "").trim().length >= 12) {
        textNode = candidate;
        break;
      }
    }
    if (!textNode) return "";

    const value = textNode.nodeValue ?? "";
    const start = value.search(/\S/);
    const end = Math.min(start + 24, value.length);
    if (start < 0 || end - start < 8) return "";

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = window.getSelection();
    if (!selection) return "";
    selection.removeAllRanges();
    selection.addRange(range);
    layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection.toString();
  });
  expect(selectedText).toBeTruthy();
  await expect(page.getByTestId("selection-toolbar")).toBeVisible();
  return selectedText;
}

test("Alice and Bob collaborate on the shared reading flow", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await openDemoPaper(alice, "alice@koalalab.dev");
    await openDemoPaper(bob, "bob@koalalab.dev");

    const aliceRows = alice.getByTestId("annotation-list-item");
    await expect(aliceRows.first()).toBeVisible();
    const aliceCountBefore = await aliceRows.count();
    const bobRows = bob.getByTestId("annotation-list-item");
    await expect(bobRows.first()).toBeVisible();
    const bobCountBefore = await bobRows.count();
    const selectedText = await selectShortPhrase(alice);
    const sharedToken = `e2e-${Date.now()}`;
    await alice.getByTestId("selection-comment-toggle").click();
    await alice.getByTestId("selection-comment-input").fill(sharedToken);
    await alice.getByTestId("selection-comment-submit").click();
    await expect(aliceRows).toHaveCount(aliceCountBefore + 1);
    const aliceSharedRow = aliceRows.last();
    await expect(aliceSharedRow).toContainText(selectedText.trim());
    await aliceSharedRow.click();
    await expect(alice.getByText(sharedToken, { exact: true })).toBeVisible();
    const aliceCountAfterShared = await aliceRows.count();

    await expect(bobRows).toHaveCount(bobCountBefore + 1);
    await bobRows.last().click();
    await expect(bob.getByText(sharedToken, { exact: true })).toBeVisible();

    const replyToken = `e2e-reply-${Date.now()}`;
    await bob.getByTestId("thread-reply-action").click();
    await bob.getByTestId("thread-reply-input").fill(replyToken);
    await bob.getByTestId("thread-reply-submit").click();
    await expect(bob.getByText(replyToken, { exact: true })).toBeVisible();
    await expect(alice.getByText(replyToken, { exact: true })).toBeVisible();

    const privateToken = `e2e-private-${Date.now()}`;
    const bobCountBeforePrivate = await bobRows.count();
    await selectShortPhrase(bob);
    await bob.getByTestId("selection-visibility-toggle").click();
    await expect(bob.getByTestId("selection-visibility-toggle")).toContainText("Private");
    await bob.getByTestId("selection-comment-toggle").click();
    await bob.getByTestId("selection-comment-input").fill(privateToken);
    await bob.getByTestId("selection-comment-submit").click();
    await expect(bobRows).toHaveCount(bobCountBeforePrivate + 1);
    await bobRows.last().click();
    await expect(bob.getByText(privateToken, { exact: true })).toBeVisible();

    await alice.reload();
    await expect(aliceRows).toHaveCount(aliceCountAfterShared);
    await expect(alice.getByText(privateToken, { exact: true })).toHaveCount(0);

    const citationMarker = alice.locator(
      '[data-testid="citation-marker"][data-reference-id]',
    ).first();
    await expect(citationMarker).toBeVisible();
    await citationMarker.click();
    await expect(alice.getByTestId("citation-preview")).toBeVisible();
    await alice.getByTestId("citation-explain").click();
    const explainCard = alice.locator('[data-testid="ai-card"][data-kind="explain"]');
    await expect(explainCard).toBeVisible();
    await expect(explainCard).toContainText("Mock AI");

    await alice.getByRole("tab", { name: /AI/ }).click();
    const askQuestion = "What is the main idea of this paper?";
    await alice.getByTestId("ask-input").fill(askQuestion);
    await alice.getByTestId("ask-submit").click();
    const askCard = alice.locator('[data-testid="ai-card"][data-kind="ask"]');
    await expect(askCard).toContainText(askQuestion);

    await alice.reload();
    await expect(alice.getByTestId("reader-page").first()).toBeVisible();
    await alice.getByRole("tab", { name: /AI/ }).click();
    const restoredAskCard = alice.locator('[data-testid="ai-card"][data-kind="ask"]');
    await expect(restoredAskCard).toContainText(askQuestion);
    const screenshotPath = testInfo.outputPath("alice-reader-after-clear.png");
    alice.once("dialog", (dialog) => void dialog.accept());
    await alice.getByTestId("ask-clear").click();
    await expect(restoredAskCard).toHaveCount(0);
    await alice.screenshot({ path: screenshotPath });
    await testInfo.attach("alice-reader-after-clear", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await Promise.all([aliceContext.close(), bobContext.close()]);
  }
});
