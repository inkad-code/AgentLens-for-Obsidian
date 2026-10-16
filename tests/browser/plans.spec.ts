import { expect, test } from '@playwright/test';

test('billing confirmation and payment status work at desktop and mobile widths', async ({ page }) => {
  await page.route('https://example.com/**', route => route.fulfill({ body: 'Mock checkout', contentType: 'text/html' }));
  await page.setViewportSize({ width: 680, height: 989 });
  await page.goto('/?signedIn&reference=account&billingDemo');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Billing & Usage' }).click();
  await expect(page.getByRole('button', { name: 'Check Out', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Alipay | WeChat Pay', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select Ultra' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const paymentButton = page.getByRole('button', { name: 'Check Out', exact: true });
  await paymentButton.scrollIntoViewIfNeeded();
  const paymentBox = await paymentButton.boundingBox();
  const paymentColor = await paymentButton.evaluate(element => getComputedStyle(element).backgroundColor);
  await paymentButton.hover();
  expect(await paymentButton.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(paymentColor);
  expect(await paymentButton.boundingBox()).toEqual(paymentBox);
  await paymentButton.click();
  await expect(page.getByRole('dialog', { name: 'Complete your purchase in Stripe' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Continue to checkout?' })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Check Out', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('button')).toHaveCount(2);
  await page.getByRole('dialog').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'dist/billing-confirm-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 989 });
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().height < 500)).toBe(true);
  const pricing = page.getByRole('region', { name: 'Choose a plan' });
  expect(await pricing.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'dist/billing-confirm-mobile.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Check payment status' })).toBeEnabled();
  await expect(page.getByRole('dialog', { name: 'Complete your purchase in Stripe' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Complete your purchase in Stripe' })).toBeVisible();
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await expect(page.getByRole('dialog', { name: 'Payment successful' })).toBeVisible();
  await page.screenshot({ path: 'dist/billing-success-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 680, height: 989 });
  await page.screenshot({ path: 'dist/billing-success-desktop.png', fullPage: true });
  await page.getByRole('dialog', { name: 'Payment successful' }).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('billing entry, responsive cards and stable hover geometry', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 989 });
  await page.goto('/?signedIn&reference=account');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Billing & Usage' }).click();
  const pricing = page.getByRole('region', { name: 'Choose a plan' });
  await expect(pricing).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const ultra = page.getByRole('button', { name: 'Select Ultra' });
  const before = await ultra.boundingBox();
  await ultra.hover();
  expect(await ultra.boundingBox()).toEqual(before);
  expect(await ultra.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  await expect(pricing.locator('img')).toHaveCount(6);
  expect(await pricing.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: 'dist/plans-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /Annual/ }).click();
  await expect(pricing).toContainText('Ultra — $69.90/year');
  await page.getByRole('combobox').selectOption('1200');
  await expect(pricing).toContainText('Add-on Packs (1200 credits) — $9.90 one-off');
  for (const width of [375, 900]) {
    await page.setViewportSize({ width, height: 989 });
    expect(await pricing.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `dist/plans-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(pricing).not.toBeVisible();
});


test('Escape dismisses checkout and clears the local pending payment', async ({ page }) => {
  await page.route('https://example.com/**', route => route.fulfill({ body: 'Mock checkout', contentType: 'text/html' }));
  await page.goto('/?signedIn&reference=account&billingDemo');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Billing & Usage' }).click();
  await page.getByRole('button', { name: 'Check Out', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Complete your purchase in Stripe' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View pending payment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select Ultra' })).toBeEnabled();
});
