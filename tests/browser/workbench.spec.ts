import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'AgentLens', exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  const overflow = await page.locator('.agentlens-workbench, .agentlens-workbench__body, dialog[open]').evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, scroll: element.scrollWidth })));
  for (const element of overflow) expect(element.scroll).toBeLessThanOrEqual(element.width + 1);
}

test('Figma capture geometry, bundled assets, responsive navigation and demo save', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 680, height: 1084 });
  await ready(page);
  await noOverflow(page);
  await expect(page.getByLabel('Public post URL')).toHaveAttribute('readonly', '');
  await expect(page.locator('.agentlens-tabs')).toHaveCount(1);
  const tabs = await page.locator('.agentlens-tabs').boundingBox();
  const input = await page.locator('.agentlens-single-pane .agentlens-url-bar').boundingBox();
  expect(tabs?.x).toBe(20);
  expect(Math.abs(tabs!.y - 259)).toBeLessThanOrEqual(2);
  expect(input?.x).toBe(36);
  expect(Math.abs(input!.y - 343)).toBeLessThanOrEqual(2);
  expect(input?.height).toBe(44);
  expect(await page.locator('img').evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && (!image.complete || !image.naturalWidth)).length)).toBe(0);
  await page.screenshot({ path: 'dist/visual-checks/single-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: 'dist/visual-checks/single-mobile.png' });
  await page.getByRole('tab', { name: 'Single Fetch', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Bulk Fetch' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Fetch demo' }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(page.getByText(/^Saved to /)).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse folder', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select Folder' });
  await picker.getByRole('treeitem', { name: 'Research/Editorial', exact: true }).click();
  await picker.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Folder', { exact: true })).toHaveValue('Research/Editorial');
  await noOverflow(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved to Research\/Editorial/)).toHaveCount(0);
  await page.screenshot({ path: 'dist/visual-checks/single-result-mobile.png' });
  expect(errors).toEqual([]);
});

test('creator bulk selection, preview and explicit batch save remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 1084 });
  await ready(page, '?signedIn&tab=bulk');
  await page.getByLabel('Creator profile URL', { exact: true }).fill('https://instagram.com/studio_mori');
  await page.getByRole('button', { name: 'Fetch page' }).click();
  await page.getByRole('checkbox', { name: 'Select visible' }).check();
  await page.screenshot({ path: 'dist/visual-checks/bulk-desktop.png' });
  await page.getByRole('button', { name: 'Review batch manifest' }).click();
  await expect(page.getByRole('region', { name: 'Save plan and results' })).toBeVisible();
  await page.getByRole('button', { name: 'Save 2 notes to vault' }).click();
  await expect(page.getByText(/2 saved \(0 partial\); 0 failed/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.getByRole('button', { name: 'Close save results' }).click();
  await expect(page.getByRole('region', { name: 'Creator posts' })).toBeVisible();
});

test('Auto-fetch cards, three-step setup, modal focus and follow without implicit history', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 800 });
  await ready(page, '?signedIn&tab=auto');
  await expect(page.locator('.agentlens-creator-row')).toHaveCount(4);
  await noOverflow(page);
  await page.screenshot({ path: 'dist/visual-checks/auto-desktop.png' });
  await page.getByRole('button', { name: '+ Add creator' }).click();
  const dialog = page.getByRole('dialog', { name: 'Auto-Fetch New Posts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await page.screenshot({ path: 'dist/visual-checks/creator-step1.png' });
  await dialog.getByLabel('Creator profile URL', { exact: true }).fill('https://instagram.com/new_creator');
  await dialog.getByRole('button', { name: 'Parse creator' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByLabel('Destination folder', { exact: true }).fill('Research/Creators');
  await page.screenshot({ path: 'dist/visual-checks/creator-step2.png' });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button',{name:'Weekly',exact:true}).click();
  await dialog.getByLabel('Frequency', { exact: true }).selectOption('2');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: 'dist/visual-checks/creator-step3-mobile.png' });
  await dialog.getByRole('button', { name: 'Follow creator' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historical import choice' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Skip history' })).toHaveCount(0);
  await expect(page.locator('.agentlens-creator-row')).toHaveCount(5);
  await page.getByRole('button', { name: '+ Add creator' }).click();
  await page.evaluate(()=>{document.addEventListener('keydown',event=>{if(event.key==='Escape')document.body.dataset.hostEscape='received';},{once:true});});
  await page.keyboard.press('Escape');
  expect(await page.locator('body').getAttribute('data-host-escape')).toBeNull();
  await expect(page.getByRole('button', { name: '+ Add creator' })).toBeFocused();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search creators' }).fill('New creator');
  await expect(page.locator('.agentlens-creator-row')).toHaveCount(1);
  await page.screenshot({ path: 'dist/visual-checks/auto-mobile.png' });
});

test('layout stays contained across desktop and mobile widths and the host dark theme', async ({ page }) => {
  await ready(page);
  for (const width of [320, 360, 600, 640, 680, 1040]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    const nav = await page.locator('.agentlens-primary-nav').boundingBox();
    const account = await page.locator('.agentlens-account-summary').boundingBox();
    if (width > 640) expect(nav!.x + nav!.width).toBeLessThanOrEqual(account!.x);
  }
  await page.setViewportSize({ width: 680, height: 800 });
  await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
  await noOverflow(page);
  await page.screenshot({ path: 'dist/visual-checks/single-dark.png' });
});

test('single parsed reference keeps controls, document and save footer aligned', async ({ page }) => {
  await page.setViewportSize({width:680,height:992});
  await ready(page, '?signedIn&reference=single');
  const headerBox = (await page.locator('.agentlens-workbench__header').boundingBox())!;
  const brandBox = (await page.locator('.agentlens-brandline').boundingBox())!;
  expect(Math.abs((brandBox.y + brandBox.height / 2) - (headerBox.y + headerBox.height / 2))).toBeLessThanOrEqual(0.5);
  await page.getByLabel('Public post URL').fill('https://instagram.com/p/demo');
  await page.getByRole('button', {name:'Fetch preview',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save', exact:true})).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    const body = document.querySelector<HTMLElement>('.agentlens-workbench__body')!;
    body.style.scrollBehavior = 'auto'; body.scrollTop = 0;
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
  const bounds: Array<[string, number, number]> = [
    ['.agentlens-post-summary',363,61], ['.agentlens-single-controls',441,32],
    ['.agentlens-single-document',489,440], ['.agentlens-single-footer',929,62]
  ];
  for (const [selector,y,height] of bounds) {
    const rect = await page.locator(selector).boundingBox();
    expect(rect!.y, selector).toBeCloseTo(y,0);
    expect(rect!.height, selector).toBeCloseTo(height,0);
  }
  const footerBox = await page.locator('.agentlens-single-footer').boundingBox();
  const cancelBox = await page.locator('.agentlens-single-footer').getByRole('button',{name:'Cancel',exact:true}).boundingBox();
  expect(footerBox!.y + footerBox!.height - (cancelBox!.y + cancelBox!.height)).toBeGreaterThanOrEqual(14);
  const note=page.locator('.agentlens-single-document .agentlens-rendered-note');
  const properties = page.getByRole('region', {name:'Note properties'});
  await expect(properties.getByRole('term')).toHaveCount(9);
  await expect(note.locator('dl')).toHaveCount(0);
  expect((await note.boundingBox())!.y).toBeGreaterThan((await properties.boundingBox())!.y);
  const listItems=note.locator('ul > li');await expect(listItems).toHaveCount(3);
  for(const item of await listItems.all()) await expect(item).toHaveCSS('line-height','22px');
  const authorMark=page.locator('.agentlens-post-summary .agentlens-platform-icon img');
  expect(await authorMark.evaluate(async el=>{const image=el as HTMLImageElement;await image.decode();return [image.naturalWidth,image.naturalHeight];})).toEqual([16,16]);
  const media=page.getByRole('radio',{name:'Download available',exact:true});
  await expect(media).toHaveCSS('appearance','none');await expect(media).toBeChecked();
  const originalIcon=await media.evaluate(el=>getComputedStyle(el).backgroundImage);
  await page.getByRole('radio',{name:'Link only',exact:true}).check();
  await expect(media).not.toBeChecked();
  expect(await media.evaluate(el=>getComputedStyle(el).backgroundImage)).not.toBe(originalIcon);
  await media.check();
  await expect(page.locator('.agentlens-post-summary h3')).toHaveCSS('font-weight','700');
  await expect(page.locator('.agentlens-post-summary h3')).toHaveCSS('letter-spacing','normal');
  const summaryIcon=page.locator('.agentlens-post-summary .agentlens-platform-icon');
  await expect(summaryIcon).toHaveCSS('width','16px');
  await expect(page.locator('.agentlens-post-summary .agentlens-eyebrow')).toHaveCSS('font-size','12px');
  const folderEdit=page.getByRole('button',{name:'Browse folder',exact:true});
  await expect(folderEdit.locator('img')).toHaveAttribute('width','12');
  await expect(page.locator('.agentlens-single-footer').getByRole('button',{name:'Cancel',exact:true})).toHaveCSS('border-top-color','rgb(225, 223, 230)');
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await page.mouse.move(1,1);
  await page.screenshot({path:'dist/visual-checks/single-parsed-reference.png'});
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await noOverflow(page);
    await expect(page.getByRole('button',{name:'Save', exact:true})).toBeVisible();
    await page.screenshot({path:`dist/visual-checks/single-parsed-${width}.png`});
    const noteHeading=page.locator('.agentlens-single-document h1');
    await page.locator('.agentlens-single-document').hover();
    await page.mouse.wheel(0,350);
    await noteHeading.evaluate(el=>el.scrollIntoView({block:'center'}));
    await expect.poll(()=>noteHeading.evaluate(element=>{
      const bounds=element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.left+10,bounds.top+10));
    })).toBe(true);
    await page.screenshot({path:`dist/visual-checks/single-parsed-note-${width}.png`});
  }
});

test('account hides deferred maintenance and retains keyboard navigation', async ({ page }) => {
  await page.setViewportSize({width:680,height:800});
  await ready(page, '?signedIn&reference=account');
  await page.getByRole('button',{name:'Account menu'}).click();
  const account = page.getByRole('region',{name:'AgentLens account',exact:true});
  await expect(account.getByText('Basic Plan')).toBeVisible();
  await expect(account.getByRole('progressbar')).toHaveAttribute('value','20');
  const rect = await account.boundingBox();
  expect(rect!.width).toBe(320); expect(rect!.height).toBe(486);
  await expect(account.locator('.agentlens-plan-status')).toHaveCSS('height','24px');
  await expect(account.locator('.agentlens-plan-status')).toHaveCSS('background-color','rgb(236, 253, 243)');
  const actions=account.locator('.agentlens-account-actions > *');
  for(let index=0;index<5;index++) {
    const action=actions.nth(index), bounds=(await action.boundingBox())!;
    expect(bounds.height).toBe(42);expect(bounds.y-rect!.y).toBe(216+54*index);
    await expect(action).toHaveCSS('font-weight','500');
    await expect(action.locator('i img')).toHaveCSS('width',index===3?'16px':'18px');
  }
  await page.addStyleTag({content:'body {--shadow-l:0 30px 80px black;}'});
  await expect(account).toHaveCSS('box-shadow','color(srgb 0 0 0 / 0.07) 0px 12px 24px 0px');
  await account.screenshot({path:'dist/visual-checks/account-reference.png'});
  const trigger=page.getByRole('button',{name:'Account menu'});
  await expect(account.getByRole('link',{name:'Access AgentLens'})).toHaveAttribute('href','https://agentlens.example');
  await expect(account.getByRole('link',{name:'Billing & Usage'})).toHaveAttribute('href','https://agentlens.example/billing');
  await expect(account.getByRole('button',{name:'Library Maintenance'})).toHaveCount(0);
  await account.getByRole('button',{name:'Log Out'}).focus();
  await page.evaluate(()=>{document.addEventListener('keydown',event=>{if(event.key==='Escape')document.body.dataset.hostEscape='received';},{once:true});});
  await page.keyboard.press('Escape');await expect(account).toBeHidden();await expect(trigger).toBeFocused();
  expect(await page.locator('body').getAttribute('data-host-escape')).toBeNull();
  await page.keyboard.press('ArrowDown');await expect(account.getByRole('link',{name:'Access AgentLens'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(account.getByRole('link',{name:'Billing & Usage'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(account.getByRole('button',{name:'View account follows'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(account.getByRole('link',{name:'Support'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(account.getByRole('button',{name:'Log Out'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(account).toBeHidden();
  await trigger.click();
  await page.getByRole('heading',{name:'AgentLens',exact:true}).click();await expect(account).toBeHidden();
  const url=page.getByLabel('Public post URL');await url.fill('https://instagram.com/p/keep-my-draft');
  await trigger.click();
  await trigger.evaluate(el=>el.dispatchEvent(new KeyboardEvent('agentlens-escape',{key:'Escape',bubbles:true,cancelable:true})));
  await expect(account).toBeHidden();await expect(trigger).toBeFocused();
  await expect(url).toHaveValue('https://instagram.com/p/keep-my-draft');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:700});await trigger.click();await noOverflow(page);
    await account.screenshot({path:`dist/visual-checks/account-reference-${width}.png`});
    await page.keyboard.press('Escape');
  }
  await trigger.click();await account.getByRole('button',{name:'Log Out'}).click();
  await expect(trigger).toHaveCount(0);await expect(account).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Sign in / register',exact:true})).toBeVisible();

});

test('folder picker uses a real tree, preserves cancelled selection and matches the frame', async ({ page }) => {
  await page.setViewportSize({width:736,height:664});
  await ready(page, '?signedIn&reference=folder');
  await page.getByLabel('Public post URL').fill('https://instagram.com/p/demo');
  await page.getByRole('button',{name:'Fetch preview',exact:true}).click();
  await page.getByRole('button',{name:'Browse folder',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Select Folder'});
  await expect(dialog.getByLabel('Vault',{exact:true})).toHaveValue('Datebase1');
  const selected = dialog.getByRole('treeitem',{name:'Inspiration/Editorial Illustration',exact:true});
  await expect(selected).toHaveAttribute('aria-selected','true');
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBe(640); expect(bounds!.height).toBe(568);
  await expect(dialog.getByRole('button',{name:'Close dialog'})).toHaveText('×');
  const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});
  await expect(cancel).toHaveCSS('border-top-color','rgb(225, 223, 230)');
  await expect(cancel).toHaveCSS('color','rgb(41, 38, 47)');
  for(const [name,x,width] of [['Cancel',314,126],['Save',448,160]] as const){
    const actionBounds=(await dialog.getByRole('button',{name,exact:true}).boundingBox())!;
    expect(actionBounds.x-bounds!.x).toBe(x);expect(actionBounds.y-bounds!.y).toBe(512);expect(actionBounds.width).toBe(width);
  }
  await dialog.screenshot({path:'dist/visual-checks/folder-reference.png'});
  await dialog.getByRole('button',{name:'Collapse Inspiration',exact:true}).click();
  await expect(selected).toHaveCount(0);
  await dialog.getByRole('treeitem',{name:'Inspiration',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(selected).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('Selected folder path')).toHaveValue('Inspiration/Editorial Illustration');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByLabel('Folder',{exact:true})).toHaveValue('Inspiration/Editorial Illustration');
  await page.getByRole('button',{name:'Browse folder',exact:true}).click();
  await dialog.getByLabel('Selected folder path').fill('Research/New project');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByLabel('Folder',{exact:true})).toHaveValue('Research/New project');
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:700});
    await page.getByRole('button',{name:'Browse folder',exact:true}).click();
    await noOverflow(page);
    await dialog.screenshot({path:`dist/visual-checks/folder-${width}.png`});
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Browse folder',exact:true})).toBeFocused();
  }
});

test('creator destination reuses the folder tree and removes only an unsaved draft', async ({ page }) => {
  await page.setViewportSize({width:736,height:809});
  await ready(page, '?signedIn&reference=folder&tab=auto');
  await page.getByRole('button',{name:'+ Add creator'}).click();
  const dialog = page.getByRole('dialog',{name:'Auto-Fetch New Posts'});
  await expect(dialog).toHaveCSS('overflow-x','hidden');
  await dialog.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/studio_mori');
  await dialog.getByRole('button',{name:'Parse creator'}).click();
  await dialog.getByRole('button',{name:'Continue'}).click();
  await expect(dialog.getByRole('treeitem',{name:'Inspiration/Editorial Illustration',exact:true})).toHaveAttribute('aria-selected','true');
  const rect = await dialog.boundingBox();
  const tree = await dialog.getByRole('tree').boundingBox();
  expect(rect!.height).toBe(713); expect(tree!.y-rect!.y).toBe(262); expect(tree!.height).toBe(271);
  expect(tree!.x-rect!.x).toBe(32);expect(tree!.width).toBe(576);
  const download=dialog.getByRole('radio',{name:'Download available',exact:true});
  await expect(download).toHaveCSS('appearance','none');
  expect(decodeURIComponent(await download.evaluate(el=>getComputedStyle(el).backgroundImage))).toContain('fill="#2463EB"');
  await dialog.getByRole('radio',{name:'Link only',exact:true}).check();
  await expect(download).not.toBeChecked();
  await download.check();
  await page.mouse.move(0,0);await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await expect(dialog.getByRole('button',{name:'Back',exact:true})).toHaveCSS('border-color','rgb(225, 223, 230)');
  await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toHaveText('×');
  for(const [name,x,width] of [['Remove',32,128],['Back',314,126],['Continue',448,160]] as const) {
    const bounds=await dialog.getByRole('button',{name,exact:true}).boundingBox();
    expect(bounds!.x-rect!.x).toBe(x);expect(bounds!.y-rect!.y).toBe(657);expect(bounds!.width).toBe(width);expect(bounds!.height).toBe(32);
  }
  await dialog.screenshot({path:'dist/visual-checks/creator-destination-reference.png'});
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844}); await noOverflow(page);
    const title = await dialog.getByRole('heading',{name:'Auto-Fetch New Posts'}).boundingBox();
    const description = await dialog.locator(':scope > p').boundingBox();
    expect(title!.y + title!.height).toBeLessThanOrEqual(description!.y);
    await dialog.getByLabel('Destination folder',{exact:true}).scrollIntoViewIfNeeded();
    await expect(dialog.getByLabel('Destination folder',{exact:true})).toBeVisible();
    await dialog.screenshot({path:`dist/visual-checks/creator-destination-${width}.png`});
  }
  await dialog.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(dialog.getByLabel('Creator profile URL',{exact:true})).toHaveValue('');
  await expect(dialog.getByRole('button',{name:'Continue'})).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.agentlens-creator-row')).toHaveCount(4);
});

for (const scenario of ['creator','creator-failure']) {
  test(`creator profile ${scenario} state matches the reference and clears on edit`, async ({page}) => {
    await page.setViewportSize({width:736,height:809});
    await ready(page, `?signedIn&tab=auto&reference=${scenario}`);
    await page.getByRole('button',{name:'+ Add creator'}).click();
    const dialog = page.getByRole('dialog',{name:'Auto-Fetch New Posts'});
  await expect(dialog).toHaveCSS('overflow-x','hidden');
    await expect(dialog.getByRole('button',{name:'Continue'})).toBeEnabled();
    const profileBounds=await dialog.boundingBox();
    const urlBar=await dialog.locator('.agentlens-url-bar').boundingBox();
    expect(urlBar!.x-profileBounds!.x).toBe(32);expect(urlBar!.y-profileBounds!.y).toBe(198);expect(urlBar!.width).toBe(576);
    for(const [name,x,width] of [['Cancel',308,126],['Continue',448,160]] as const){
      const action=dialog.getByRole('button',{name,exact:true}),bounds=await action.boundingBox();
      expect(bounds!.x-profileBounds!.x).toBe(x);expect(bounds!.y-profileBounds!.y).toBe(653);expect(bounds!.width).toBe(width);expect(bounds!.height).toBe(32);
    }
    await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toHaveCSS('border-top-color','rgb(225, 223, 230)');
    // Figma 4223 is populated but not yet parsed.
    await dialog.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/studio_mori');
    await dialog.getByLabel('Creator profile URL',{exact:true}).blur();
    await dialog.screenshot({path:'dist/visual-checks/creator-empty-reference.png'});
    await dialog.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/studio_mori');
    await dialog.getByRole('button',{name:'Parse creator'}).click();
    if (scenario === 'creator') {
      await expect(dialog.getByText('Parsed successfully')).toBeVisible();
      const platformMark=dialog.locator('.agentlens-parsed-creator .agentlens-platform-icon img');
      const markSvg=await platformMark.evaluate(el=>atob((el as HTMLImageElement).src.split(',')[1]!));
      expect(markSvg).toContain('viewBox="0 0 18 18"');
      expect(markSvg).toContain('M9.02049 0H8.97951');
      const card=await dialog.locator('.agentlens-parsed-creator').boundingBox();
      expect(card!.x-profileBounds!.x).toBe(32);expect(card!.y-profileBounds!.y).toBe(258);expect(card!.width).toBe(580);expect(card!.height).toBe(88);
      await expect(dialog.locator('.agentlens-parse-success')).toHaveCSS('color','rgb(6, 95, 70)');
      await expect(dialog.locator('.agentlens-parse-success')).toHaveCSS('background-color','rgb(226, 250, 238)');
      await expect(dialog.getByRole('heading',{name:'董宇辉'})).toHaveCSS('font-weight','400');
      expect(await dialog.locator('.agentlens-setup-content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      await expect(dialog.getByRole('heading',{name:'董宇辉'})).toBeVisible();
      await expect(dialog.getByRole('button',{name:'Continue'})).toBeEnabled();
    } else {
      await expect(dialog.getByRole('alert')).toHaveText('Enter a public creator profile link.');
      const failedHeader=(await dialog.locator(':scope > header').boundingBox())!;
      const failedSteps=(await dialog.locator('.agentlens-setup-steps').boundingBox())!;
      expect(failedHeader.y-profileBounds!.y).toBe(27);
      expect(failedSteps.y-profileBounds!.y).toBe(88);
      await expect(dialog.getByRole('button',{name:'Continue'})).toBeEnabled();
    }
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.mouse.move(0,0);
    await dialog.screenshot({path:`dist/visual-checks/${scenario}-reference.png`});
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:844}); await noOverflow(page);
      await dialog.screenshot({path:`dist/visual-checks/${scenario}-${width}.png`});
    }
    await dialog.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/another_creator');
    await expect(dialog.getByText('Parsed successfully')).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('button',{name:'Continue'})).toBeEnabled();
    await dialog.getByRole('button',{name:'Continue'}).click();
    await expect(dialog.getByRole('alert')).toHaveText('Parse a creator profile before continuing.');
    await expect(dialog.getByLabel('Creator profile URL',{exact:true})).toBeFocused();
    await expect(dialog.locator('.agentlens-setup-steps li[aria-current=step]')).toContainText('Creator Profile');
    await expect(dialog.getByRole('tree')).toHaveCount(0);
  });
}

test('remove creator asks for confirmation and preserves the list on cancel', async ({page}) => {
  await page.setViewportSize({width:680,height:800});
  await ready(page,'?signedIn&tab=auto');
  await page.getByRole('button',{name:'Edit',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Auto-Fetch New Posts'}).getByRole('button',{name:'Remove',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Remove this creator from Auto-Fetch?'});
  await expect(dialog).toBeVisible();
  await expect(page.locator('.agentlens-creator-row')).toHaveCount(4);
  const bounds = await dialog.boundingBox(); expect(bounds!.width).toBe(320); expect(bounds!.height).toBe(212);
  await expect(dialog).toHaveCSS('overflow-x','hidden');
  expect(await dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});
  const cancelBounds=(await cancel.boundingBox())!;
  expect(cancelBounds.width).toBe(120);expect(cancelBounds.height).toBe(32);
  expect(cancelBounds.x-bounds!.x).toBe(33);expect(cancelBounds.y-bounds!.y).toBe(156);
  await expect(cancel).toHaveCSS('border-top-color','rgb(229, 231, 235)');
  await expect(cancel).toHaveCSS('color','rgb(55, 65, 81)');
  await expect(dialog.getByRole('button',{name:'Close dialog'})).toHaveText('×');
  await dialog.screenshot({path:'dist/visual-checks/remove-creator-reference.png'});
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});await noOverflow(page);
    await expect(cancel).toBeInViewport();
    await expect(dialog.getByRole('button',{name:'Remove',exact:true})).toBeInViewport();
    await dialog.screenshot({path:`dist/visual-checks/remove-creator-${width}.png`});
  }
  await page.setViewportSize({width:680,height:800});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('.agentlens-creator-row')).toHaveCount(4);
  await page.getByRole('dialog',{name:'Auto-Fetch New Posts'}).getByRole('button',{name:'Remove',exact:true}).click();
  await dialog.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.agentlens-creator-row')).toHaveCount(3);
});

test('schedule and searchable timezones preserve canonical values and reject invalid input', async ({page}) => {
  await page.setViewportSize({width:736,height:809});
  await ready(page,'?signedIn&tab=auto&reference=schedule');
  await page.getByRole('button',{name:'+ Add creator'}).click();
  const dialog=page.getByRole('dialog',{name:'Auto-Fetch New Posts'});
  await dialog.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/studio_mori');
  await dialog.getByRole('button',{name:'Parse creator'}).click();
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await dialog.getByLabel('Destination folder',{exact:true}).fill('Illustration/Educational Illustration');
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  const frequency=dialog.getByRole('combobox',{name:'Frequency',exact:true});
  await expect(frequency.locator('option')).toHaveCount(168);
  await frequency.selectOption('168');
  await dialog.getByRole('combobox',{name:'Unit',exact:true}).selectOption('week');
  await expect(frequency.locator('option')).toHaveCount(12);
  await expect(frequency).toHaveValue('12');
  await frequency.focus();await expect(frequency).toBeFocused();await page.keyboard.press('Tab');
  await expect(dialog.getByRole('combobox',{name:'Unit',exact:true})).toBeFocused();
  await frequency.selectOption('11');await expect(frequency).toHaveValue('11');
  await dialog.getByRole('combobox',{name:'Unit',exact:true}).selectOption('day');
  await expect(frequency.locator('option')).toHaveCount(168);
  await dialog.getByRole('button',{name:'Weekly',exact:true}).click();
  await dialog.getByLabel('Frequency',{exact:true}).selectOption('2');
  await expect(dialog.getByRole('button',{name:'Weekly',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await page.mouse.move(0,0);
  await expect(dialog.getByRole('button',{name:'Remove',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Back',exact:true})).toHaveCSS('border-color','rgb(225, 223, 230)');
  await expect(dialog.getByRole('button',{name:'Weekly',exact:true}).locator('img')).toHaveAttribute('width','9');
  const scheduleBounds=await dialog.boundingBox();
  for(const [name,x] of [['Back',314],['Follow creator',448]] as const) {
    const bounds=await dialog.getByRole('button',{name,exact:true}).boundingBox();
    expect(bounds!.x-scheduleBounds!.x).toBe(x);expect(bounds!.y-scheduleBounds!.y).toBe(657);expect(bounds!.height).toBe(32);
  }
  for(const [selector,y,width,height] of [
    ['.agentlens-setup-steps',84,570,67],
    ['.agentlens-frequency-presets > div',188,576,36],
    ['.agentlens-schedule-every > div',262,576,32],
    ['.agentlens-timezone-input',340,576,32],
    ['.agentlens-schedule-summary dl',420,580,86],
    ['.agentlens-schedule-creator',518,580,50],
    ['.agentlens-schedule-summary .agentlens-parse-error',581,580,54]
  ] as const) {
    const bounds=await dialog.locator(selector).boundingBox();
    expect(bounds!.x-scheduleBounds!.x).toBe(32);expect(bounds!.y-scheduleBounds!.y).toBe(y);
    expect(bounds!.width).toBe(width);expect(bounds!.height).toBe(height);
  }
  expect(await dialog.locator('.agentlens-setup-content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(dialog.locator('.agentlens-frequency-presets legend')).toHaveCSS('font-weight','600');
  await dialog.screenshot({path:'dist/visual-checks/schedule-reference.png'});
  const timezoneFrame=dialog.locator('.agentlens-timezone-input');
  await expect(timezoneFrame).toHaveCSS('border-top-color','rgb(241, 241, 241)');
  const initialTimezoneBounds=await timezoneFrame.boundingBox();
  await dialog.getByRole('button',{name:'Show timezones'}).click();
  await expect(timezoneFrame).toHaveCSS('border-top-color','rgb(36, 99, 235)');
  await expect(timezoneFrame).toHaveCSS('box-shadow','none');
  await expect(dialog.getByRole('option',{name:/^Shanghai/})).toBeVisible();
  await dialog.screenshot({path:'dist/visual-checks/timezone-default-options.png'});
  await dialog.getByRole('option',{name:/^Hefei/}).hover();
  await expect(dialog.getByRole('option',{name:/^Hefei/})).toHaveAttribute('aria-selected','false');
  await expect(dialog.getByRole('option',{name:/^Hefei/}).locator('span')).toHaveCSS('color','rgb(36, 99, 235)');
  await dialog.screenshot({path:'dist/visual-checks/timezone-hover.png'});
  await page.keyboard.press('Escape');
  const timezone=dialog.getByRole('combobox',{name:'Timezone',exact:true});
  await timezone.fill('He');
  await expect(timezone).toHaveCSS('border-top-width','0px');
  await expect(timezone).toHaveCSS('box-shadow','none');
  await expect(timezoneFrame).toHaveCSS('box-shadow','rgb(36, 99, 235) 0px 0px 0px 1px inset');
  expect(await timezoneFrame.boundingBox()).toEqual(initialTimezoneBounds);
  await expect(dialog.getByRole('button',{name:'Follow creator'})).toBeDisabled();
  await expect(dialog.getByRole('option',{name:/Hefei/})).toBeVisible();
  await expect(dialog.getByRole('option',{name:/Henan/})).toBeVisible();
  await expect(dialog.getByRole('option',{name:/Henan/}).locator('mark')).toHaveText('He');
  await dialog.screenshot({path:'dist/visual-checks/timezone-search.png'});
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(timezone).toHaveValue('Asia/Shanghai');
  await expect(dialog.getByRole('listbox')).toHaveCount(0);
  await timezone.fill('America/New_York');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(timezone).toHaveValue('America/New_York');
  await timezone.fill('Not/A_Timezone');
  await expect(dialog.getByRole('button',{name:'Follow creator'})).toBeDisabled();
  await expect(dialog.getByText(/No matching timezone/)).toBeVisible();
  await timezone.evaluate(el=>el.dispatchEvent(new KeyboardEvent('agentlens-escape',{key:'Escape',bubbles:true,cancelable:true}))); await expect(dialog).toBeVisible();
  await expect(timezone).toHaveAttribute('aria-invalid','true');
  await expect(timezone).toHaveCSS('color','rgb(255, 120, 133)');
  await expect(timezone).toHaveCSS('box-shadow','none');
  await expect(timezoneFrame).toHaveCSS('border-top-color','rgb(255, 120, 133)');
  await expect(timezoneFrame).toHaveCSS('box-shadow','none');
  await dialog.screenshot({path:'dist/visual-checks/timezone-error-state.png'});
  await timezone.fill('Asia/Shanghai');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await timezone.blur();
  await expect(timezoneFrame).toHaveCSS('border-top-color','rgb(241, 241, 241)');
  await expect(timezoneFrame).toHaveCSS('box-shadow','none');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844}); await noOverflow(page);
    await dialog.getByText(/Note: After following/).scrollIntoViewIfNeeded();
    await expect(dialog.getByText(/Note: After following/)).toBeVisible();
    await dialog.screenshot({path:`dist/visual-checks/schedule-${width}.png`});
  }
  await dialog.getByRole('button',{name:'Follow creator'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Historical import choice'})).toHaveCount(0);
});

test('bulk list preserves selections through filters and failed pagination', async ({page}) => {
  await page.setViewportSize({width:680,height:1090});
  await page.setViewportSize({width:680,height:800});
  await ready(page,'?signedIn&tab=bulk&reference=bulk');
  const inputBounds=await page.locator('.agentlens-bulk-toolbar .agentlens-url-bar').boundingBox();
  expect(inputBounds!.y).toBe(295);
  const bulkUrl=page.getByLabel('Creator profile URL',{exact:true});
  const textStart=await bulkUrl.evaluate(el=>el.getBoundingClientRect().x+parseFloat(getComputedStyle(el).paddingLeft));
  expect(textStart).toBe(50);
  expect(await bulkUrl.evaluate(el=>getComputedStyle(el,'::placeholder').color)).toBe('rgb(156, 163, 175)');
  const emptyIcon=await page.locator('.agentlens-bulk-pane .agentlens-empty-proof').boundingBox();
  expect(emptyIcon!.y).toBe(507);
  const emptyParse=page.getByRole('button',{name:'Fetch page'});
  await expect(emptyParse).toBeEnabled();await expect(emptyParse).toHaveCSS('background-color','rgb(36, 99, 235)');
  await page.screenshot({path:'dist/visual-checks/bulk-empty-reference.png'});
  await emptyParse.click();
  expect(await page.getByLabel('Creator profile URL',{exact:true}).evaluate((el:HTMLInputElement)=>el.validity.valueMissing)).toBe(true);
  await expect(page.locator('.agentlens-bulk-post')).toHaveCount(0);
  await page.setViewportSize({width:680,height:1090});
  await page.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/studio_mori');
  await page.getByRole('button',{name:'Fetch page'}).click();
  await expect(page.locator('.agentlens-bulk-post')).toHaveCount(5);
  const bulkRadio=page.getByRole('radio',{name:'Download available',exact:true});
  await expect(bulkRadio).toBeChecked();
  expect(await bulkRadio.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('data:image/svg+xml');
  expect(await page.getByRole('combobox',{name:'Note template',exact:true}).evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('data:image/svg+xml');
  const selectedPost=page.getByRole('checkbox',{name:'Select AI in Healthcare',exact:true});
  await selectedPost.check();
  await expect(selectedPost).toHaveCSS('appearance','none');
  expect(decodeURIComponent(await selectedPost.evaluate(el=>getComputedStyle(el).backgroundImage))).toContain('fill="#2463EB"');
  await page.getByRole('button',{name:'Fetch more · estimated 1 credit'}).click();
  await expect(page.getByRole('alert')).toHaveText('This content couldn’t be loaded right now. Try again later.');
  await expect(page.getByRole('checkbox',{name:'Select AI in Healthcare',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Has media',exact:true}).click();
  await expect(page.locator('.agentlens-bulk-post')).toHaveCount(5);
  await page.getByRole('button',{name:'Already saved',exact:true}).click();
  await expect(page.locator('.agentlens-bulk-post')).toHaveCount(0);
  await page.getByRole('button',{name:'All',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Select AI in Healthcare',exact:true})).toBeChecked();
  await page.evaluate(async()=>{await document.fonts.ready;const body=document.querySelector<HTMLElement>('.agentlens-workbench__body')!;body.style.scrollBehavior='auto';body.scrollTop=0;await new Promise(requestAnimationFrame);});
  for(const [name,x,width] of [['All',331,41],['New',377,65],['Already saved',447,96],['Has media',548,96]] as const){
    const bounds=(await page.getByRole('button',{name,exact:true}).boundingBox())!;
    expect(bounds.x).toBe(x);expect(bounds.width).toBe(width);expect(bounds.height).toBe(32);
  }
  await page.screenshot({path:'dist/visual-checks/bulk-list-reference.png'});
  for(const width of [680,390,320]) {
    await page.setViewportSize({width,height:width===680?600:844});await noOverflow(page);
    await expect(page.locator('.agentlens-bulk-controls')).toHaveCSS('position','static');
    await expect(page.locator('.agentlens-bulk-selection-bar')).toHaveCSS('position','sticky');
    const lastPostTitle=page.locator('.agentlens-bulk-post').last().locator('strong');
    await lastPostTitle.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    expect(await lastPostTitle.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);})).toBe(true);
    const stickyBar=page.locator('.agentlens-bulk-selection-bar');
    const barBounds=await stickyBar.boundingBox();const bodyBounds=await page.locator('.agentlens-workbench__body').boundingBox();
    expect(barBounds!.y).toBeCloseTo(bodyBounds!.y,0);
    const filterButton=page.getByRole('button',{name:'Has media',exact:true});
    expect(await filterButton.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    await expect(page.getByRole('button',{name:'Review batch manifest'})).toBeVisible();
    const topButton=await page.locator('.agentlens-bulk-pane .agentlens-back-to-top').boundingBox();
    const footer=await page.locator('.agentlens-bulk-footer').boundingBox();
    if(topButton) expect(topButton.y+topButton.height).toBeLessThanOrEqual(footer!.y);
    await page.screenshot({path:`dist/visual-checks/bulk-list-${width}.png`});
  }
  await page.getByRole('button',{name:'Review batch manifest'}).click();
  await expect(page.getByRole('button',{name:'Save 1 notes to vault'})).toBeVisible();
});

test('batch save matches confirmation, live progress and results frames', async ({page}) => {
  await page.setViewportSize({width:680,height:800});
  await ready(page,'?signedIn&tab=bulk&reference=save');
  await page.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/studio_mori');
  await page.getByRole('button',{name:'Fetch page'}).click();
  await page.getByRole('checkbox',{name:'Select visible'}).check();
  await page.getByRole('button',{name:'Review batch manifest'}).click();
  await expect(page.locator('.agentlens-save-plan-row')).toHaveCount(4);
  await expect(page.getByLabel('Creator profile URL',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('tablist',{name:'AgentLens workflows'})).toHaveCount(0);
  expect((await page.locator('.agentlens-save-plan-row').first().boundingBox())!.y).toBe(279);
  await page.screenshot({path:'dist/visual-checks/save-confirm-desktop.png'});
  await page.getByRole('button',{name:'Save 4 notes to vault'}).click();
  const progress=page.getByRole('progressbar',{name:'Batch save progress',exact:true});
  await expect(progress).toHaveAttribute('value','0');
  await expect(progress).toHaveAttribute('aria-valuetext','0 of 4, 0%');
  await expect(page.locator('.agentlens-batch-progress')).toContainText('0/4 · 0%');
  await page.evaluate(()=>window.dispatchEvent(new Event('fixture:next-save')));
  await expect(progress).toHaveAttribute('value','1');
  await expect(progress).toHaveAttribute('aria-valuetext','1 of 4, 25%');
  await expect(page.locator('.agentlens-batch-progress')).toContainText('1/4 · 25%');
  await expect(page.getByRole('button',{name:'Back to loaded posts'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Back to loaded posts'})).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.getByRole('button',{name:'Back to loaded posts'})).toHaveCSS('font-size','13px');
  await expect(page.getByRole('button',{name:'Back to loaded posts'})).toHaveCSS('border-top-color','rgb(225, 223, 230)');
  const savingCta=page.getByRole('button',{name:'Saving',exact:true});
  await expect(savingCta).toBeDisabled();
  await expect(savingCta).toHaveCSS('background-color','rgb(219, 219, 219)');
  await page.screenshot({path:'dist/visual-checks/save-progress-desktop.png'});
  await page.getByRole('button',{name:'Back to loaded posts'}).click();
  await expect(page.getByRole('checkbox',{name:'Select visible'})).toBeDisabled();
  await page.getByRole('button',{name:'Review batch manifest'}).click();
  for(const value of ['2','3']){
    await page.evaluate(()=>window.dispatchEvent(new Event('fixture:next-save')));
    await expect(progress).toHaveAttribute('value',value);
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('fixture:next-save')));
  await expect(page.getByRole('button',{name:'Close save results'})).toBeVisible();
  await expect(page.locator('.agentlens-save-plan-status.is-success')).toHaveCount(4);
  await page.getByRole('button',{name:'Capturing the essence of urban life through a lens',exact:true}).click();
  await page.getByRole('button',{name:'Open note',exact:true}).click();
  await expect(page.locator('#root')).toHaveAttribute('data-opened-note','Street Photography/Urban Exploration/save-1.md');
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});await page.mouse.move(1,1);
  const firstResult=(await page.locator('.agentlens-save-plan-row').first().boundingBox())!;
  expect(firstResult.x).toBe(20);expect(firstResult.y).toBe(282);expect(firstResult.width).toBe(640);expect(firstResult.height).toBe(93);
  const success=page.locator('.agentlens-save-plan-status.is-success').first();
  await expect(success.locator('img')).toHaveAttribute('width','12');
  await expect(success).toHaveCSS('width','80px');await expect(success).toHaveCSS('height','22px');
  await expect(success).toHaveCSS('color','rgb(19, 115, 51)');await expect(success).toHaveCSS('background-color','rgb(230, 249, 237)');
  const close=page.getByRole('button',{name:'Close save results'}),closeBounds=(await close.boundingBox())!;
  expect(closeBounds.x).toBe(544);expect(closeBounds.y).toBe(754);expect(closeBounds.width).toBe(120);
  await expect(page.getByRole('button',{name:'Open note',exact:true})).toHaveCSS('border-top-color','rgb(225, 223, 230)');
  await page.screenshot({path:'dist/visual-checks/save-result-desktop.png'});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    await noOverflow(page);
    for(const title of await page.locator('.agentlens-save-plan-copy h4 button').all()) {
      await expect(title).toHaveCSS('white-space','nowrap');
      await expect(title).toHaveCSS('text-overflow','ellipsis');
      await expect(title).toHaveAttribute('title',/.+/);
    }
    const lastTitle=page.locator('.agentlens-save-plan-row').last().getByRole('button');
    await lastTitle.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
    await expect.poll(()=>lastTitle.evaluate(element=>{const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.screenshot({path:`dist/visual-checks/save-result-${width}.png`});
  }
  await page.getByRole('button',{name:'Close save results'}).click();
  await page.getByRole('button',{name:'Review batch manifest'}).click();
  await expect(page.locator('.agentlens-save-plan-status.is-success')).toHaveCount(4);
});

test('bulk preview drawer matches the reference and returns keyboard focus', async({page})=>{
  await page.setViewportSize({width:680,height:1090});
  await ready(page,'?signedIn&tab=bulk&reference=bulk');
  await page.getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/studio_mori');
  await page.getByRole('button',{name:'Fetch page'}).click();
  const trigger=page.getByRole('button',{name:'Preview The hidden details behind a great everyday camera'});
  await trigger.click();
  const drawer=page.getByRole('dialog',{name:'Preview',exact:true});
  await expect(drawer).toBeVisible();
  const bounds=(await drawer.boundingBox())!;
  expect(bounds.x).toBe(208);expect(bounds.y).toBe(0);expect(bounds.width).toBe(472);expect(bounds.height).toBe(1090);
  const headerBounds=(await drawer.locator(':scope > header').boundingBox())!;
  expect(headerBounds.y+headerBounds.height-bounds.y).toBe(56);
  const closeBounds=(await drawer.getByRole('button',{name:'Close dialog'}).boundingBox())!;
  const closeImageBounds=(await drawer.locator(':scope > header button img').boundingBox())!;
  expect(closeBounds.width).toBe(24);expect(closeBounds.height).toBe(32);
  expect(closeImageBounds.width).toBe(24);expect(closeImageBounds.height).toBe(24);
  await expect(drawer.getByRole('heading',{name:'The hidden details behind a great everyday camera'})).toBeVisible();
  const titleBounds=(await drawer.getByRole('heading',{name:'The hidden details behind a great everyday camera'}).boundingBox())!;
  expect(titleBounds.x-bounds.x).toBe(16);
  const propertiesBounds = (await drawer.getByRole('region', {name:'Note properties'}).boundingBox())!;
  expect(propertiesBounds.y-bounds.y).toBe(72);
  expect(titleBounds.y).toBeGreaterThan(propertiesBounds.y+propertiesBounds.height);
  await expect(drawer.getByRole('heading',{name:'The hidden details behind a great everyday camera'})).toHaveCSS('font-size','15px');
  await page.screenshot({path:'dist/visual-checks/bulk-preview-desktop.png'});
  await page.mouse.click(bounds.x - 20, bounds.y + 100);
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);await expect(trigger).toBeFocused();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    await trigger.click();
    await noOverflow(page);
    expect((await drawer.boundingBox())!.width).toBe(width);
    await page.screenshot({path:`dist/visual-checks/bulk-preview-${width}.png`});
    await drawer.getByRole('button',{name:'Close dialog'}).click();
  }
});

test('Auto-Fetch overview aligns the four status cards and supports narrow screens', async({page})=>{
  await page.setViewportSize({width:680,height:800});
  await ready(page,'?signedIn&tab=auto&reference=auto');
  const autoNav=page.locator('.agentlens-primary-nav button').nth(1);
  const autoBounds=(await autoNav.boundingBox())!;
  expect(autoBounds.x).toBeCloseTo(356,0);expect(autoBounds.width).toBeCloseTo(89,0);
  await expect(page.getByRole('searchbox',{name:'Search creators'})).toHaveCSS('padding-left','11px');
  await expect(page.getByRole('searchbox',{name:'Search creators'})).toHaveCSS('font-size','14px');
  await expect(page.locator('.agentlens-creator-tools')).toBeHidden();
  const cards=page.locator('.agentlens-creator-row');await expect(cards).toHaveCount(4);
  const first=(await cards.first().boundingBox())!;
  expect(first.x).toBe(20);expect(first.y).toBe(277);expect(first.width).toBe(314);expect(first.height).toBe(266);
  expect((await cards.nth(2).boundingBox())!.y).toBe(555);
  await expect(cards.first().getByText('Fetching now',{exact:true})).toBeVisible();
  await expect(cards.nth(2).getByText('Fetching Failed',{exact:true})).toBeVisible();
  const assertIdentityFitsBeforeBadge=async()=>{
    for(const card of await cards.all()){
      const identity=(await card.locator('.agentlens-creator-identity').boundingBox())!;
      const badge=(await card.locator('.agentlens-creator-badge').boundingBox())!;
      const name=(await card.locator('.agentlens-creator-identity strong').boundingBox())!;
      const handle=(await card.locator('.agentlens-creator-handle').boundingBox())!;
      expect(identity.x+identity.width).toBeLessThanOrEqual(badge.x);
      expect(name.x+name.width).toBeLessThanOrEqual(identity.x+identity.width);
      expect(handle.x+handle.width).toBeLessThanOrEqual(identity.x+identity.width);
    }
  };
  await assertIdentityFitsBeforeBadge();
  for(const [index,badge] of (await cards.locator('.agentlens-creator-badge').all()).entries()){
    await expect(badge).toHaveCSS('height','28px');await expect(badge).toHaveCSS('font-weight','600');
    await expect(badge).toHaveCSS('color',['rgb(146, 64, 14)','rgb(6, 95, 70)','rgb(153, 27, 27)','rgb(29, 78, 216)'][index]!);
    await expect(badge).toHaveCSS('background-color',['rgb(254, 243, 199)','rgb(226, 250, 238)','rgb(254, 226, 226)','rgb(228, 237, 255)'][index]!);
    expect(await badge.locator('img').evaluate(async el=>{const img=el as HTMLImageElement;await img.decode();return [img.naturalWidth,img.naturalHeight];})).toEqual([7,7]);
  }

  const folder=await cards.first().locator('.agentlens-creator-folder-link').getAttribute('title');
  await cards.first().getByRole('button',{name:`Open folder ${folder}`,exact:true}).click();
  await expect(page.locator('#root')).toHaveAttribute('data-opened-folder',folder!);
  await expect(cards.first().locator('.agentlens-creator-folder-link img')).toHaveCSS('width','12px');
  await expect(cards.first().getByRole('button',{name:'Edit'}).locator('.agentlens-action-state-icon')).toHaveCSS('width','20px');
  await page.mouse.move(1,1);await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await page.screenshot({path:'dist/visual-checks/auto-reference-desktop.png'});
  await page.getByRole('searchbox',{name:'Search creators'}).fill('no-match');
  await expect(cards).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Search creators'}).fill('instagram');
  await expect(cards).toHaveCount(4);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await noOverflow(page);
    await assertIdentityFitsBeforeBadge();
    await page.screenshot({path:`dist/visual-checks/auto-reference-${width}.png`});
    for(const card of await cards.all()){
      const folderAction=card.locator('.agentlens-creator-folder-link');
      await folderAction.scrollIntoViewIfNeeded();
      expect(await folderAction.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
      await expect(card.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
    }
    await page.locator('.agentlens-workbench__body').evaluate(el=>{el.scrollTop=0;});
  }
});


test('shared buttons and action icons use the Figma interaction states', async({page})=>{
 await page.setViewportSize({width:680,height:800});await ready(page,'?signedIn&tab=auto&reference=auto');
 const add=page.getByRole('button',{name:'+ Add creator'});
 await expect(add).toHaveCSS('background-color','rgb(36, 99, 235)');
 const intro=page.locator('.agentlens-auto-pane .agentlens-pane__intro');
 const initialIntro=await intro.boundingBox();
 await expect(add).toHaveCSS('height','32px');
 await add.hover();await expect(add).toHaveCSS('background-color','rgb(16, 77, 208)');
 await expect(add).toHaveCSS('height','36px');
 expect(await intro.boundingBox()).toEqual(initialIntro);
 await add.screenshot({path:'dist/visual-checks/button-primary-hover.png'});
 await page.mouse.down();await expect(add).toHaveCSS('background-color','rgb(4, 63, 191)');
 await expect(add).toHaveCSS('height','32px');
 await add.screenshot({path:'dist/visual-checks/button-primary-active.png'});
 await page.mouse.move(1,1);await page.mouse.up();
 const scheduled=page.locator('.agentlens-creator-row').nth(1);
 const run=scheduled.getByRole('button',{name:'Check now',exact:true});const icon=run.locator('.agentlens-action-state-icon');
 const readState=()=>icon.evaluate(el=>getComputedStyle(el).backgroundImage);
 const normal=await readState();await run.hover();const hover=await readState();expect(hover).not.toBe(normal);
 await page.mouse.down();const active=await readState();expect(active).not.toBe(hover);
 await scheduled.screenshot({path:'dist/visual-checks/creator-action-active.png'});
 await page.mouse.move(1,1);await page.mouse.up();
 const disabled=page.locator('.agentlens-creator-row').first().getByRole('button',{name:'Pause future checks'});
 await expect(disabled).toBeDisabled();await expect(disabled).toHaveCSS('opacity','1');
 await add.click();const dialog=page.getByRole('dialog',{name:'Auto-Fetch New Posts'});
 await expect(dialog.getByRole('button',{name:'Parse creator',exact:true})).toHaveCSS('background-color','rgb(219, 219, 219)');
 const input=dialog.getByRole('textbox',{name:'Creator profile URL'});await input.focus();
 await expect(input).toHaveCSS('outline-style','none');
 await expect(input).toHaveCSS('box-shadow','none');
 await expect(dialog.locator('.agentlens-url-bar')).toHaveCSS('border-top-color','rgb(36, 99, 235)');
 await dialog.screenshot({path:'dist/visual-checks/input-focus-disabled-action.png'});
});

test('email authentication frames, password controls and reset preserve credential boundaries',async({page})=>{
 await page.setViewportSize({width:680,height:800});await ready(page,'?reference=auth');
 await page.getByRole('button',{name:'Sign in / register'}).click();
 const login=page.getByRole('region',{name:'Sign in to your account'});
 const loginHeading=page.getByRole('heading',{name:'Sign In to unlock monthly perks',exact:true});
 await expect(loginHeading).toHaveCSS('font-family',/Nunito/);
 await expect(login.getByRole('button',{name:'Sign in with Google'})).toHaveCSS('font-family',/AgentLens Noto Sans Display/);
 await login.getByRole('textbox',{name:'Email'}).fill('reviewer@example.com');
 const password=login.getByLabel('Password *',{exact:true});await password.fill('reference-pass');
 await loginHeading.click();
 const authEmail=login.getByRole('textbox',{name:'Email'});
 await expect(authEmail).toHaveCSS('padding-left','16px');
 await expect(authEmail).toHaveCSS('border-top-color','rgb(229, 231, 235)');
 expect(await authEmail.evaluate(el=>el.getBoundingClientRect().x+parseFloat(getComputedStyle(el).paddingLeft)+parseFloat(getComputedStyle(el).borderLeftWidth))).toBe(159);
 await page.screenshot({path:'dist/visual-checks/auth-login-desktop.png'});
 const showPassword=login.getByRole('button',{name:'Show password'});await expect(showPassword.locator('svg')).toHaveAttribute('viewBox','0 0 24 24');
 await expect(showPassword).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await showPassword.hover();await expect(showPassword).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 const eyeBox=await showPassword.boundingBox();const fieldBox=await password.boundingBox();
 expect(Math.abs((eyeBox!.y+eyeBox!.height/2)-(fieldBox!.y+fieldBox!.height/2))).toBeLessThanOrEqual(1);
 await expect(showPassword.locator('svg circle')).toHaveCount(1);
 await showPassword.click();await expect(password).toHaveAttribute('type','text');
 const hidePassword=login.getByRole('button',{name:'Hide password'});
 await expect(hidePassword.locator('svg')).toHaveAttribute('viewBox','0 0 24 24');
 await expect(hidePassword.locator('svg circle')).toHaveCount(0);
 await expect(hidePassword.locator('svg path').last()).toHaveAttribute('d','m2 2 20 20');
 await hidePassword.click();await expect(password).toHaveAttribute('type','password');
 await login.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-auth-attempt','login');
 await expect(login.getByRole('alert')).toHaveText('The email or password is incorrect. Check them and try again.');await expect(password).toHaveValue('');
 await login.getByRole('button',{name:'Forgot your password?'}).click();await expect(login.getByRole('status')).toContainText('If an account uses this email');
 await login.getByRole('button',{name:'Sign Up',exact:true}).click();
 const register=page.getByRole('region',{name:'Create your account'});
 await expect(register.getByRole('checkbox')).toHaveCSS('width','18px');
 await expect(register.getByRole('checkbox')).toHaveCSS('height','18px');
 await expect(register.getByRole('checkbox')).toHaveCSS('appearance','none');
 await register.getByRole('textbox',{name:'Full name'}).fill('John Doe');
 await register.getByRole('textbox',{name:'Email'}).fill('reviewer@example.com');
 await register.getByLabel('Password *',{exact:true}).fill('reference-pass');
 await page.setViewportSize({width:680,height:826});await page.getByRole('heading',{name:'Sign up to unlock monthly perks',exact:true}).click();
 await register.getByRole('textbox',{name:'Full name'}).fill('');
 await register.getByRole('checkbox').check();
 await page.getByRole('heading',{name:'Sign up to unlock monthly perks',exact:true}).click();
 await expect(register.getByRole('button',{name:'Create account',exact:true})).toHaveCSS('background-color','rgb(23, 105, 255)');
 await expect(register.getByRole('button',{name:'Create account',exact:true})).toHaveCSS('font-weight','700');
 await expect(register.getByRole('button',{name:'Sign up with Google'})).toHaveCSS('font-weight','400');
 await expect(register.getByRole('link',{name:'Terms of Use'})).toHaveAttribute('href','https://agentlensapi.io/terms');
 await expect(register.getByRole('link',{name:'Privacy Policy'})).toHaveAttribute('href','https://agentlensapi.io/privacy');
 await page.screenshot({path:'dist/visual-checks/auth-register-desktop.png'});
 await register.getByRole('textbox',{name:'Full name'}).fill('John Doe');
 await register.getByLabel('Confirm password').fill('different');await register.getByRole('checkbox').check();
 await register.getByRole('button',{name:'Create account',exact:true}).click();await expect(register.getByRole('alert')).toHaveText('Passwords do not match.');
 await expect(register.getByLabel('Confirm password')).toHaveAttribute('aria-invalid','true');
 await register.getByLabel('Confirm password').fill('reference-pass');
 await register.getByRole('button',{name:'Create account',exact:true}).click();
 const registrationPassword=register.getByLabel('Password *',{exact:true});
 await expect(register.getByRole('alert')).toContainText('include a letter, a number, and a special character');
 await expect(registrationPassword).toHaveAttribute('aria-invalid','true');
 await expect(registrationPassword).toHaveCSS('border-top-color','rgb(255, 120, 133)');
 await expect(page.locator('html')).toHaveAttribute('data-auth-attempt','login');
 await expect(registrationPassword).toHaveValue('reference-pass');
 await page.screenshot({path:'dist/visual-checks/auth-register-password-error.png'});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await noOverflow(page);await page.screenshot({path:`dist/visual-checks/auth-register-${width}.png`});}
 await registrationPassword.fill('example1!');await register.getByLabel('Confirm password').fill('example1!');
 await register.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-auth-attempt','register');
 await expect(registrationPassword).toHaveValue('');await expect(register.getByLabel('Confirm password')).toHaveValue('');
 await page.getByRole('button',{name:'Back'}).click();await expect(page.getByRole('heading',{name:'Fetch from social media'})).toBeVisible();
});

test('guest sign-up prompt preserves the demo and routes each restricted workflow',async({page})=>{
 await page.setViewportSize({width:680,height:801});await ready(page);
 const input=page.getByLabel('Public post URL');const demo=await input.inputValue();
 await input.focus();await page.keyboard.type('x');
 const prompt=page.getByRole('dialog',{name:'Sign up to start free with real links'});
 await expect(prompt).toBeVisible();const box=(await prompt.boundingBox())!;expect(box.width).toBe(320);expect(box.height).toBe(143);
 await expect(prompt).toHaveCSS('overflow-x','hidden');await expect(prompt).toHaveCSS('overflow-y','hidden');
 const promptOverflow=await prompt.evaluate(element=>({x:element.scrollWidth-element.clientWidth,y:element.scrollHeight-element.clientHeight}));
 expect(promptOverflow.x).toBeLessThanOrEqual(1);expect(promptOverflow.y).toBeLessThanOrEqual(1);
 const cancel=prompt.getByRole('button',{name:'Cancel',exact:true});
 const cancelBounds=(await cancel.boundingBox())!;
 expect(cancelBounds.width).toBe(120);expect(cancelBounds.height).toBe(32);
 expect(cancelBounds.x-box.x).toBe(36);expect(cancelBounds.y-box.y).toBe(83);
 await expect(cancel).toHaveCSS('border-top-color','rgb(229, 231, 235)');
 await expect(cancel).toHaveCSS('color','rgb(55, 65, 81)');
 const close=prompt.getByRole('button',{name:'Close dialog'});await expect(close).toBeFocused();
 await prompt.screenshot({path:'dist/visual-checks/signup-prompt-keyboard-focus.png'});
 await close.blur();
 await prompt.screenshot({path:'dist/visual-checks/signup-prompt-desktop.png'});
 await prompt.getByRole('button',{name:'Cancel',exact:true}).click();await expect(input).toHaveValue(demo);await expect(input).toBeFocused();
 await page.getByRole('button',{name:'sign up',exact:true}).click();await page.keyboard.press('Escape');await expect(prompt).toHaveCount(0);
 await page.getByRole('tab',{name:'Bulk Fetch',exact:true}).click();await page.getByRole('button',{name:'Sign Up',exact:true}).click();
 await prompt.getByRole('button',{name:'Sign Up',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign up to unlock monthly perks',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back'}).click();await page.getByRole('button',{name:/^Auto-Fetch$/i}).click();
 await page.getByRole('button',{name:'Sign Up',exact:true}).click();await page.setViewportSize({width:320,height:844});await noOverflow(page);
 await prompt.screenshot({path:'dist/visual-checks/signup-prompt-mobile.png'});
 await prompt.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByRole('heading',{name:'Sign in to follow creators'})).toBeVisible();
});

test('single empty and demo-help variants keep the reference illustration stationary',async({page})=>{
 await page.setViewportSize({width:680,height:1084});await ready(page);
 const input=page.getByLabel('Public post URL');await expect(input).toHaveValue('');await expect(input).toHaveAttribute('placeholder','Paste a public post URL…');
 await expect(input).toHaveCSS('color','rgb(41, 38, 47)');
 expect(await input.evaluate(el=>getComputedStyle(el,'::placeholder').color)).toBe('rgb(156, 163, 175)');
 const illustration=page.locator('.agentlens-single-pane .agentlens-empty-proof');
 const initial=(await illustration.boundingBox())!;expect(initial.x).toBe(324);expect(initial.y).toBe(555);
 await expect(page.getByRole('button',{name:'Start Free',exact:true})).toHaveCSS('height','28px');
 await expect(page.locator('.agentlens-account-summary')).toHaveCSS('gap','14px');
 await page.screenshot({path:'dist/visual-checks/single-guest-reference.png'});
 await input.focus();await expect(page.locator('.agentlens-demo-help')).toBeVisible();
 const focused=(await illustration.boundingBox())!;expect(focused.x).toBe(324);expect(focused.y).toBe(555);
 const notice=(await page.locator('.agentlens-demo-help').boundingBox())!;expect(notice.x).toBe(36);expect(notice.y).toBe(395);expect(notice.height).toBe(36);
 await input.blur();await page.mouse.move(0,0);
 await page.screenshot({path:'dist/visual-checks/single-demo-notice-reference.png'});
 await page.getByRole('button',{name:'Fetch demo'}).click();await expect(page.getByRole('button',{name:'Save', exact:true})).toBeVisible();
});

test('single URL input can be cleared without losing focus', async ({page}) => {
 await page.setViewportSize({width:680,height:1084}); await ready(page,'?signedIn');
 const input=page.getByLabel('Public post URL');
 await input.fill('https://example.com/post-to-clear');
 const clear=page.getByRole('button',{name:'Clear URL'});
 await expect(clear).toBeVisible();
 await clear.click();
 await expect(input).toHaveValue('');
 await expect(input).toBeFocused();
 await expect(page.getByRole('button',{name:'Clear URL'})).toHaveCount(0);
});

test('bulk and auto-fetch URL inputs expose clear controls', async ({page}) => {
 await page.setViewportSize({width:680,height:1084}); await ready(page,'?signedIn&tab=bulk');
 const bulkInput=page.getByLabel('Creator profile URL',{exact:true});
 await bulkInput.fill('https://instagram.com/creator-to-clear');
 await page.getByRole('button',{name:'Clear creator profile URL'}).click();
 await expect(bulkInput).toHaveValue(''); await expect(bulkInput).toBeFocused();

 await page.locator('.agentlens-primary-nav button').nth(1).click();
 await page.getByRole('button',{name:'+ Add creator'}).click();
 const dialog=page.getByRole('dialog',{name:'Auto-Fetch New Posts'});
 const autoInput=dialog.getByLabel('Creator profile URL',{exact:true});
 await autoInput.fill('https://instagram.com/creator-to-clear');
 await dialog.getByRole('button',{name:'Clear creator profile URL'}).click();
 await expect(autoInput).toHaveValue(''); await expect(autoInput).toBeFocused();
 await page.keyboard.press('Escape');

 const search=page.getByRole('searchbox',{name:'Search creators'});
 await search.fill('creator');
 await page.getByRole('button',{name:'Clear creator search'}).click();
 await expect(search).toHaveValue('');
});

test('all 25 platform marks use complete original Figma exports',async({page})=>{
 await page.setViewportSize({width:599,height:583});await page.goto('/?reference=platforms');
 const icons=page.locator('.agentlens-platform-icon');await expect(icons).toHaveCount(25);await expect(page.locator('.agentlens-platform-mark')).toHaveCount(0);
 await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode())));
 for(let index=0;index<25;index++){const box=(await icons.nth(index).boundingBox())!;expect(box).toMatchObject({x:120+index%5*88,y:92+Math.floor(index/5)*88,width:36,height:36});}
 await page.screenshot({path:'dist/visual-checks/platform-board-reference.png'});
});


test('button state board uses production styles for all eight Figma specimens',async({page})=>{
 await page.setViewportSize({width:435,height:164});await page.goto('/?reference=buttons');
 await page.evaluate(()=>document.fonts.ready);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root}=await cdp.send('DOM.getDocument');
 const fontNode=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#specimen-primary-0'});
 const renderedFonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:fontNode.nodeId});
 expect(renderedFonts.fonts).toEqual([expect.objectContaining({postScriptName:'Nunito-Medium',isCustomFont:true,glyphCount:6})]);
 for(const style of ['primary','secondary']){
  for(const state of [1,2]){
   const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:`#specimen-${style}-${state}`});
   await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:state===1?['hover']:['hover','active']});
  }
  for(const state of [0,1,2,3]){
   const button=page.locator(`#specimen-${style}-${state}`);
   const bounds=(await button.boundingBox())!;
   expect(bounds.width).toBe(82);expect(bounds.height).toBe(style==='primary'&&state===1?36:32);
   expect(bounds.x).toBe([24,135,238,341][state]);expect(bounds.y).toBe(style==='primary'?24:94);
   await expect(button).toHaveCSS('font-size',style==='secondary'&&state===0?'13px':'14px');
   await expect(button).toHaveCSS('font-weight','500');
   await expect(button).toHaveCSS('corner-shape',/^(round|superellipse\(1\))$/);
   await expect(button).toHaveCSS('border-top-left-radius',style==='secondary'&&state===0?'6px':'8px');
   await expect(button).toHaveCSS('background-color',state===3?'rgb(219, 219, 219)':style==='secondary'?'rgb(255, 255, 255)':['rgb(36, 99, 235)','rgb(16, 77, 208)','rgb(4, 63, 191)'][state]!);
   if(state===3)await expect(button).toBeDisabled();
  }
 }
 await expect(page.locator('#specimen-secondary-2')).toHaveCSS('color','rgb(30, 86, 216)');
 await page.screenshot({path:'dist/visual-checks/button-board-reference.png'});
 await cdp.detach();
});


test('existing creator reuses setup dialog and requires a fresh settings preview', async ({page}) => {
  await page.setViewportSize({width:736,height:809});
  await ready(page,'?signedIn&tab=auto&reference=schedule');
  await page.getByRole('button',{name:'+ Add creator'}).click();
  await page.getByRole('dialog',{name:'Auto-Fetch New Posts'}).getByLabel('Creator profile URL',{exact:true}).fill('https://instagram.com/unsaved_draft');
  await page.keyboard.press('Escape');
  const edit=page.getByRole('button',{name:'Edit',exact:true}).first();
  await edit.click();
  const dialog=page.getByRole('dialog',{name:'Auto-Fetch New Posts'});
  await expect(dialog.getByRole('button',{name:'Remove',exact:true})).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'Frequency',exact:true})).toBeVisible();
  await page.mouse.move(0,0);await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await dialog.screenshot({path:'dist/visual-checks/creator-edit-schedule.png'});
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  await expect(dialog.getByRole('tree')).toBeVisible();
  await dialog.getByLabel('Destination folder',{exact:true}).fill('Inspiration/Photography');
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Unit',exact:true}).selectOption('week');
  await dialog.getByRole('combobox',{name:'Frequency',exact:true}).selectOption('2');
  await dialog.getByRole('button',{name:'Review changes',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Confirm changes',exact:true})).toBeVisible();
  await dialog.getByRole('combobox',{name:'Frequency',exact:true}).selectOption('3');
  await expect(dialog.getByRole('button',{name:'Confirm changes',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Review changes',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm changes',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(edit).toBeFocused();
  await edit.click();await expect(dialog.getByRole('combobox',{name:'Frequency',exact:true})).toHaveValue('3');
  await expect(dialog.locator('.agentlens-schedule-summary')).toContainText('Inspiration/Photography');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});await noOverflow(page);
    await dialog.locator('.agentlens-schedule-creator').scrollIntoViewIfNeeded();
    await dialog.screenshot({path:`dist/visual-checks/creator-edit-${width}.png`});
  }
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'+ Add creator'}).click();
  await expect(dialog.getByLabel('Creator profile URL',{exact:true})).toHaveValue('https://instagram.com/unsaved_draft');
  await page.keyboard.press('Escape');
});


test('input state board renders all six production border and text states',async({page})=>{
 await page.setViewportSize({width:394,height:459});await page.goto('/?reference=inputs');
 await page.evaluate(()=>document.fonts.ready);
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root}=await cdp.send('DOM.getDocument');
 for(const [index,pseudo] of [[1,'hover'],[2,'focus-within']] as const){
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:`#input-state-${index}`});
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[pseudo]});
 }
 const typing=page.getByRole('textbox',{name:'正在输入',exact:true});await typing.fill('');
 for(let index=0;index<6;index++){
  const frame=page.locator(`#input-state-${index}`), input=frame.locator('input');
  expect(await frame.boundingBox()).toMatchObject({x:82,y:36+index*59,width:280,height:32});
  await expect(frame).toHaveCSS('border-top-color',index===5?'rgb(255, 120, 133)':index===2||index===3?'rgb(36, 99, 235)':'rgb(241, 241, 241)');
  await expect(frame).toHaveCSS('border-radius','8px');
  const arrow=await frame.locator('img').boundingBox();expect(arrow!.y).toBe(45+index*59);expect(arrow!.height).toBe(14);expect(arrow!.width).toBe(14);
  await expect(frame).toHaveCSS('box-shadow',index===3?'rgb(36, 99, 235) 0px 0px 0px 1px inset':'none');
  await expect(input).toHaveCSS('border-top-width','0px');await expect(input).toHaveCSS('box-shadow','none');
  await expect(input).toHaveCSS('line-height','12px');
  await expect(input).toHaveCSS('color',index===5?'rgb(255, 120, 133)':'rgb(41, 38, 47)');
 }
 await page.screenshot({path:'dist/visual-checks/input-board-reference.png',caret:'initial'});
 await typing.fill('2');await page.getByRole('textbox',{name:'输入完成',exact:true}).focus();
 await expect(page.locator('#input-state-3')).toHaveCSS('border-top-color','rgb(241, 241, 241)');
 await expect(page.locator('#input-state-3')).toHaveCSS('box-shadow','none');
 await cdp.detach();
});

test('action state board shows all sixteen original exports through production state selectors',async({page})=>{
 await page.setViewportSize({width:445,height:236});await page.goto('/?reference=actions');
 await page.evaluate(()=>document.fonts.ready);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root}=await cdp.send('DOM.getDocument');
 for(const [row,kind] of ['run','play','pause','settings'].entries()){
  const sources=[];
  for(const column of [0,1,2,3]){
   const selector=`#action-${kind}-${column}`,button=page.locator(selector);
   if(column===1||column===2){
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:column===1?['hover']:['hover','active']});
   }
   expect(await button.boundingBox()).toEqual({x:43+column*66,y:43+row*44,width:32,height:32});
   const icon=button.locator('.agentlens-action-state-icon');
   await expect(icon).toHaveCSS('width','32px');await expect(icon).toHaveCSS('height','32px');
   const state=['default','hover','active','disabled'][column]!;
   const source=await icon.evaluate((el,state)=>{const css=getComputedStyle(el);return {actual:css.backgroundImage,expected:css.getPropertyValue(`--action-icon-${state}`)};},state);
   expect(source.actual.replaceAll('"','')).toBe(source.expected.replaceAll('"','').trim());sources.push(source.actual);
   if(column===3){await expect(button).toBeDisabled();await expect(button).toHaveCSS('opacity','1');}
  }
  expect(new Set(sources).size).toBe(4);
 }
 await page.screenshot({path:'dist/visual-checks/action-board-reference.png'});
 await cdp.detach();
});

test('timezone board renders complete popup geometry, hover, selection and search emphasis',async({page})=>{
 await page.setViewportSize({width:2099,height:994});await page.goto('/?reference=timezones');
 await page.evaluate(()=>document.fonts.ready);
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root}=await cdp.send('DOM.getDocument');
 for(const [selector,states] of [['#timezone-specimen-1',['hover']],['#timezone-specimen-2',['focus-within']],['#timezone-board-0-1',['hover']]] as const){
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[...states]});
 }
 for(const index of [0,1,2]){
  expect(await page.locator(`#timezone-specimen-${index}`).boundingBox()).toEqual({x:82,y:[36,99,168][index],width:580,height:36});
  const list=page.locator(`#timezone-board-${index}-options`);
  expect(await list.boundingBox()).toEqual({x:[82,708,1344][index],y:208,width:580,height:288});
  await expect(list.getByRole('option')).toHaveCount(index===2?2:5);
  for(const [row,option] of (await list.getByRole('option').all()).entries()){
   expect(await option.boundingBox()).toEqual({x:[98,724,1360][index],y:232+row*48,width:548,height:36});
  }
 }
 await expect(page.locator('#timezone-board-0-1')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(page.locator('#timezone-board-0-1 > span')).toHaveCSS('color','rgb(36, 99, 235)');
 await expect(page.locator('#timezone-board-1-1')).toHaveCSS('border-top-color','rgb(36, 99, 235)');
 await expect(page.locator('#timezone-board-2-0 mark')).toHaveText('He');
 await expect(page.locator('#timezone-board-2-1')).toContainText('Hefei');
 await page.screenshot({path:'dist/visual-checks/timezone-board-reference.png'});
 await cdp.detach();
});

test('single parse scrolls to its summary and retains controls while content scrolls',async({page})=>{
 for(const width of [680,390,320]){
  await page.setViewportSize({width,height:600});
  await ready(page,'?signedIn&reference=single');
  await page.getByLabel('Public post URL').fill('https://instagram.com/p/demo');
  await page.getByRole('button',{name:'Fetch preview',exact:true}).click();
  const body=page.locator('.agentlens-workbench__body');
  const summary=page.locator('.agentlens-post-summary');
  await expect(summary).toBeVisible();
  await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  const bodyBounds=await body.boundingBox();
  await expect.poll(async()=>Math.abs((await summary.boundingBox())!.y-bodyBounds!.y-4)).toBeLessThan(1);
  await body.evaluate(el=>{(el as HTMLElement).style.scrollBehavior='auto';el.scrollTop+=220;});
  const controls=page.locator('.agentlens-single-controls');
  await expect(controls).toHaveCSS('position','sticky');
  await expect(controls).toHaveCSS('background-color','rgb(246, 248, 255)');
  await expect.poll(async()=>Math.abs((await controls.boundingBox())!.y-bodyBounds!.y)).toBeLessThan(1);
  const input=controls.getByRole('combobox',{name:'Note template',exact:true});
  expect(await input.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await page.screenshot({path:`dist/visual-checks/single-sticky-${width}.png`});
 }
});

test('parsed preview responds to narrow host container inside a wide desktop window', async ({page}) => {
  await page.setViewportSize({width:1100,height:820});
  await ready(page,'?signedIn&reference=single');
  await page.addStyleTag({content:`.agentlens-workbench {width:648px;height:700px} ::-webkit-scrollbar {width:12px;height:12px}`});
  await page.getByLabel('Public post URL').fill('https://instagram.com/p/reference');
  await page.getByRole('button',{name:'Fetch preview',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save', exact:true})).toBeVisible();
  await noOverflow(page);
  const controls=page.locator('.agentlens-single-controls');
  const body=page.locator('.agentlens-workbench__body');
  const controlsBox=(await controls.boundingBox())!;
  const bodyBox=(await body.boundingBox())!;
  expect(controlsBox.x).toBeGreaterThanOrEqual(bodyBox.x);
  expect(controlsBox.x+controlsBox.width).toBeLessThanOrEqual(bodyBox.x+bodyBox.width);
  await expect(controls).toHaveCSS('flex-wrap','wrap');
  await page.getByRole('button',{name:'Save', exact:true}).scrollIntoViewIfNeeded();
  await noOverflow(page);
  await page.locator('.agentlens-workbench').screenshot({path:'dist/visual-checks/single-native-container.png'});
});

test('native modal keeps Figma palette and tab geometry under dark host defaults', async ({ page }) => {
 await page.setViewportSize({width:984,height:768}); await ready(page);
 await page.evaluate(() => {
  const root=document.querySelector('#root')!;
  root.className='modal agentlens-workbench-modal';
  const content=document.createElement('div');content.className='modal-content';
  while(root.firstChild)content.append(root.firstChild);root.append(content);
  const header=document.createElement('div');header.className='modal-header';root.prepend(header);
  document.body.classList.add('theme-dark');
 });
 await page.addStyleTag({content:'.modal {padding:16px; background:#222;display:flex;flex-direction:column;} .modal-header {margin-bottom:0.75em;height:0;} button {height:32px;line-height:32px;white-space:nowrap;box-shadow:0 1px 2px #000;}'});
 const workbench=page.locator('.agentlens-workbench');
 await expect(workbench).toHaveCSS('--background-primary','#ffffff');
 await expect(page.locator('#root')).toHaveCSS('padding','0px');
 await expect(page.locator('#root > .modal-header')).toBeHidden();
 expect((await workbench.boundingBox())!.y).toBe((await page.locator('#root').boundingBox())!.y);
 const tabs=page.locator('.agentlens-tabs');
 expect((await tabs.boundingBox())!.height).toBe(64);
 expect((await tabs.getByRole('tab').first().boundingBox())!.height).toBeGreaterThanOrEqual(58);
 await expect(page.locator('.agentlens-import-shell')).not.toHaveCSS('background-image','none');
 await noOverflow(page);
 await page.screenshot({path:'dist/visual-checks/native-host-dark-isolation.png'});
});


test('workflow hover preserves the original tab silhouettes without rectangular fills', async ({ page }) => {
 await page.setViewportSize({width:680,height:800}); await ready(page);
 const tabs=page.getByRole('tablist',{name:'AgentLens workflows'});
 for (const workflow of ['Single Fetch','Bulk Fetch']) {
  await tabs.getByRole('tab',{name:workflow,exact:true}).click();
  for (const label of ['Single Fetch','Bulk Fetch']) {
   const tab=tabs.getByRole('tab',{name:label,exact:true});
   await tab.hover();
   await expect(tab).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
   await expect(tab).toHaveCSS('box-shadow','none');
   await tabs.screenshot({path:`dist/visual-checks/tab-hover-${workflow.replace(' ','-')}-${label.replace(' ','-')}.png`});
  }
 }
});


test('workbench hides legacy and current native close controls only inside its modal', async ({page}) => {
 await ready(page);
 await page.evaluate(() => {
  const root=document.querySelector('#root')!;root.classList.add('agentlens-workbench-modal');
  for(const className of ['modal-close-button','modal-header-button']) {
   const button=document.createElement('button');button.className=className;button.textContent='Native close';root.prepend(button);
  }
  const other=document.createElement('button');other.className='modal-header-button';other.textContent='Other modal close';document.body.append(other);
 });
 await expect(page.locator('#root > .modal-close-button')).toBeHidden();
 await expect(page.locator('#root > .modal-header-button')).toBeHidden();
 await expect(page.getByRole('button',{name:'Other modal close'})).toBeVisible();
});


test('empty Single Fetch surface does not expose a Note preview tooltip', async ({page}) => {
  await ready(page);
  await page.locator('.agentlens-preview-card').hover();
  await expect(page.locator('[title="Note preview"], [aria-label="Note preview"]')).toHaveCount(0);
  await expect(page.getByRole('tooltip', {name: 'Note preview'})).toHaveCount(0);
});
