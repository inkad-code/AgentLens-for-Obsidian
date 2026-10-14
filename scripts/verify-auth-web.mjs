import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base=process.env.AGENTLENS_AUTH_WEB_URL || 'http://127.0.0.1:5180';
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('dist/visual-checks',{recursive:true});
try {
  const page=await browser.newPage();
  const goto = url => page.goto(url, {waitUntil: "domcontentloaded"});
  page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
  await page.route("https://www.googletagmanager.com/**", route => route.abort());
  let starts=0;
  let approvals=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/oauth/google/start') {starts++;return route.fulfill({contentType:'text/html',body:'<h1>Mock Google authorization</h1>'});}
    if(path==='/api/auth/oauth/providers') return route.fulfill({json:{providers:[{provider:'google',enabled:true}]}});
    if(path==='/api/v1/auth/device/info') return route.fulfill({json:{data:{clientName:'Obsidian'}}});
    if(path==='/api/me/profile') return route.fulfill({json:{id:'test-user',name:'Test',email:'test@example.com',role:'user'}});
    if(path==='/api/v1/auth/device/approve') {
      approvals++;
      expect(route.request().postDataJSON()).toEqual({userCode:'ABCD-EFGH'});
      return route.fulfill({json:{data:{approved:true}}});
    }
    return route.fulfill({json:{}});
  });
  await goto(`${base}/device?code=ABCD-EFGH&provider=google`);
  await expect(page.getByRole('heading',{name:'Mock Google authorization'})).toBeVisible();
  expect(starts).toBe(1);
  expect(await page.evaluate(()=>sessionStorage.getItem('agentlens_oauth_return_to'))).toBe('/device?code=ABCD-EFGH');
  await goto(`${base}/auth/oauth/callback?token=mock-web-token`);
  expect(starts).toBe(1);
  await expect(page.getByText(/Authorization complete/)).toBeVisible();
  expect(approvals).toBe(1);
  await goto(`${base}/device?code=DIFF-CODE`);
  await expect(page.getByRole('button',{name:'Authorize Obsidian plugin',exact:true})).toBeVisible();
  expect(approvals).toBe(1);
  await page.evaluate(()=>{localStorage.clear();sessionStorage.setItem('agentlens_oauth_return_to','/device?code=ABCD-EFGH');});
  await goto(`${base}/auth/oauth/callback?oauth_error=access_denied`);
  await expect(page).toHaveURL(/sign-in\?returnTo=%2Fdevice%3Fcode%3DABCD-EFGH/);
  await page.route('https://challenges.cloudflare.com/**',route=>route.abort());
  await page.addInitScript(()=>{
    window.turnstile={render:(_element,options)=>{window.__verification=options;options.callback('mock-challenge');return 'test-widget';},remove:()=>{},reset:()=>{}};
  });
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:800});
    await goto(`${base}/plugin-verification?state=11111111-1111-4111-8111-111111111111`);
    await expect(page.getByRole('button',{name:'Return to Obsidian'})).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({timeout:10000,path:`dist/visual-checks/registration-verification-${width}.png`});
    await page.evaluate(()=>window.__verification['expired-callback']());
    await expect(page.getByRole('button',{name:'Return to Obsidian'})).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('expired');
  }
  await goto(`${base}/plugin-verification?state=invalid`);
  await expect(page.getByRole('button',{name:'Return to Obsidian'})).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('invalid');
  console.log('Passed Google intent, scoped device return and approval, OAuth cancellation, verification expiry, invalid state and desktop/mobile layout. External OAuth/Turnstile mocked.');
} finally {await browser.close();}
