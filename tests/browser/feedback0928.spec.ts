import { test, expect } from '@playwright/test';

for (const tab of ['single', 'bulk']) {
  test(`${tab} parsing shows a yellow status until the request completes`, async ({page}) => {
    await page.goto(`/?signedIn&reference=feedback&tab=${tab}`);
    await page.getByLabel(tab === 'single' ? 'Public post URL' : 'Creator profile URL', {exact:true})
      .fill(tab === 'single' ? 'https://youtube.com/watch?v=post-a' : 'https://youtube.com/@creator');
    await page.getByRole('button', {name:tab === 'single' ? 'Fetch preview' : 'Fetch page', exact:true}).click();
    const status = page.locator('.agentlens-parse-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveCSS('background-color', 'rgb(255, 242, 216)');
    await page.screenshot({path:`dist/visual-checks/0928-${tab}-parsing.png`});
    await page.evaluate(() => window.dispatchEvent(new Event('fixture:finish-parse')));
    await expect(status).toHaveCount(0);
  });
}

test('saved preview hides copy action and keeps results reachable on narrow screens', async ({page}) => {
  await page.goto('/?signedIn&reference=save');
  await page.getByLabel('Public post URL').fill('https://instagram.com/p/save-0');
  await page.getByRole('button', {name:'Fetch preview', exact:true}).click();
  await expect(page.getByRole('region', {name:'Note properties'}).getByRole('term')).toHaveCount(9);
  await page.getByRole('button', {name:'Save', exact:true}).click();
  await page.getByRole('button', {name:'Save 1 notes to vault'}).click();
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:next-save')));
  await page.getByRole('button', {name:'Close save results'}).click();
  for (const width of [680, 390, 320]) {
    await page.setViewportSize({width, height:900});
    await expect(page.getByRole('button', {name:'Save another copy'})).toHaveCount(0);
    await expect(page.getByRole('button', {name:'Save', exact:true})).toHaveText('View results');
    expect(await page.locator('.agentlens-workbench').evaluate(el => el.scrollWidth <= el.clientWidth+1)).toBe(true);
    await page.screenshot({path:`dist/visual-checks/0928-saved-${width}.png`});
  }
});
