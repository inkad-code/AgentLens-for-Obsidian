import { test, expect } from '@playwright/test';

test('single save uses plan, solid progress, collapse and results on desktop and narrow screens', async ({page}) => {
  await page.setViewportSize({width:680,height:900});
  await page.goto('/?signedIn&reference=save');
  await page.getByLabel('Public post URL').fill('https://instagram.com/p/save-0');
  await page.getByRole('button',{name:'Fetch preview',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('region',{name:'Save plan and results'})).toBeVisible();
  await expect(page.getByRole('tablist',{name:'AgentLens workflows'})).toHaveCount(0);
  await page.getByRole('button',{name:'Save 1 notes to vault'}).click();
  await expect(page.getByRole('progressbar',{name:'Batch save progress',exact:true})).toHaveAttribute('value','0');
  const row=page.locator('.agentlens-row-progress:indeterminate');
  await expect(row).toBeVisible();
  expect(await row.evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await row.evaluate(el=>getComputedStyle(el,'::-webkit-progress-bar').backgroundImage)).toBe('none');
  await page.getByRole('button',{name:'Back to loaded posts'}).click();
  await expect(page.getByLabel('Public post URL')).toHaveAttribute('readonly','');
  await expect(page.getByRole('radio',{name:'Link only',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(row).toBeVisible();
  await expect(page.getByRole('tablist',{name:'AgentLens workflows'})).toHaveCount(0);
  await page.screenshot({path:'dist/visual-checks/round2-single-progress.png'});
  await page.evaluate(()=>window.dispatchEvent(new Event('fixture:next-save')));
  await expect(page.getByRole('button',{name:'Close save results'})).toBeVisible();
  await expect(page.locator('.agentlens-save-plan-status')).toHaveText('Success');
  await page.setViewportSize({width:390,height:844});
  const widths=await page.locator('.agentlens-workbench').evaluate(el=>[el.clientWidth,el.scrollWidth]);
  expect(widths[1]! - widths[0]!).toBeLessThanOrEqual(1);
  await page.screenshot({path:'dist/visual-checks/round2-single-results.png'});
  await page.getByRole('button',{name:'Close save results'}).click();
  await expect(page.getByLabel('Public post URL')).toBeVisible();
});

test('bulk share text becomes a usable URL without browser validation blocking parsing', async ({page}) => {
  await page.goto('/?signedIn&tab=bulk');
  const input=page.getByLabel('Creator profile URL',{exact:true});
  await input.fill('分享主页 https://xhslink.cn/o/6vXQzsZRUd3 复制打开');
  await expect(input).toHaveValue('https://xhslink.cn/o/6vXQzsZRUd3');
  await page.getByRole('button',{name:'Fetch page'}).click();
  const label=page.getByRole('checkbox',{name:'Select visible'}).locator('..');
  await expect(label).toBeVisible();
  await expect(label.locator('span')).toHaveCount(0);
  await page.getByRole('checkbox',{name:'Select visible'}).check();
  await expect(label.locator('span')).not.toHaveText('0');
});
