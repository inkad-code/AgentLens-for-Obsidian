import { AgentLensError } from "../../src/core/errors";
import { TimezoneReference } from "./TimezoneReference";
import { ActionReference } from "./ActionReference";
import { InputReference } from './InputReference';
import { ButtonReference } from './ButtonReference';
import { createRoot } from 'react-dom/client';
import { WorkbenchApp } from '../../src/ui/WorkbenchApp';
import { saveImages } from './save-images';
import { PlatformIcon } from '../../src/ui/workbench/shared';
import { platformAssets } from '../../src/ui/workbench/platformAssets';
import { bulkImages } from './bulk-images';
import { autoAvatar } from './auto-avatar';
import { creatorAvatar } from './creator-avatar';
import { fixtureImages } from './images';
import { creator, signedInService, successfulSave } from './fixtures';
const query = new URLSearchParams(location.search);
const service = signedInService();
if (query.has('billingDemo')) {
  let paid = false;
  service.billing = {
    plans: async () => ['basic', 'pro', 'ultra', 'mega'].map((plan, index) => ({ plan: plan as 'basic' | 'pro' | 'ultra' | 'mega', priceMonthly: [0, 2.9, 6.9, 9.9][index]!, priceYearly: [0, 29.9, 69.9, 99.9][index]!, creditsLimit: [20, 300, 1000, 2000][index]!, active: true })),
    dashboard: async () => ({ plan: paid ? 'ultra' : 'basic', billingCycle: 'monthly', subscriptionStatus: 'active', scheduledPlan: null, scheduledBillingCycle: null, scheduledEffectiveAt: null, checkoutStatus: null, fetchReason: null }),
    createIntent: async () => ({ id: 'demo-intent', displayedAmount: 6.9, currency: 'USD', checkoutStatus: 'not_started' }),
    checkout: async () => { paid = true; return { checkoutUrl: 'https://example.com/demo-payment', status: 'pending' }; },
    intent: async () => ({ id: 'demo-intent', displayedAmount: 6.9, currency: 'USD', checkoutStatus: paid ? 'paid' : 'pending' }),
    change: async () => ({ status: 'change_scheduled', invoiceUrl: null, effectiveAt: '2026-11-12' }),
    portal: async () => ({ portalUrl: 'https://example.com/demo-billing' }),
    subscription: async () => {}
  };
}
const capabilities = await service.capabilities();
service.capabilities = async () => ({...capabilities, platforms: ['pinterest','instagram','tiktok','x','xiaohongshu','douyin','wechat_channels','bilibili','facebook','threads','bluesky'].map(id => ({id,label:id,single:true,profile:true,autoFetch:true,profileScope:'creator',mediaDownload:true,transcript:false,available:true}))});
let fixtureAuth = {status: query.has('signedIn') ? 'signed_in' : 'signed_out', accessToken:'fixture', accessTokenExpiresAt:Date.now()+60000} as any;
const authListeners = new Set<(state:any)=>void>();
service.authState = () => fixtureAuth;
service.subscribeAuth = listener => {authListeners.add(listener);return ()=>{authListeners.delete(listener);};};
service.signOut = async () => {fixtureAuth={status:'signed_out'};authListeners.forEach(listener=>listener(fixtureAuth));};
service.restoreAuth = async () => service.authState() as any;
service.startSignIn = async () => ({status:'authorizing',authorization:{userCode:'DEMO-CODE',verificationUri:'https://example.com',deviceCode:'fixture',interval:5,expiresIn:300},expiresAt:Date.now()+300000}) as any;
service.savePrepared = async entries => ({successes:entries.map(({manifest})=>successfulSave(manifest)),failures:[]});
let creators = ['scheduled','running','retry_pending','paused'].map((state,index)=>creator({creatorId:`creator-${index}`,displayName:`studio_mori ${index+1}`,platform:'instagram', schedulerState:state === 'paused' ? 'scheduled' : state as any,autoFetchEnabled:state!=='paused',lastError:state==='retry_pending'?'Provider unavailable':null,activeJobId:state==='running'?'job':null}));
service.autoFetchSetup = async () => ({settings:{homeTimezone:'Asia/Shanghai',confirmed:true}, creators});
service.parseCreator = async url => ({creator:{creatorId:'new',displayName:['creator','schedule'].includes(query.get('reference') ?? '') ? '董宇辉' : 'New creator',profileUrl:url,platform:'instagram',handle:'studio_mori',avatarUrl:['creator','schedule'].includes(query.get('reference') ?? '') ? creatorAvatar : fixtureImages.avatar},creatorToken:'fixture',creatorTokenExpiresAt:'2099-01-01T00:00:00Z'}) as any;
service.followCreator = async input => { const added = creator({creatorId:'new',displayName:'New creator',profileUrl:input.parsed.creator.profileUrl,saveFolderPath:input.saveFolderPath,timezone:input.timezone,mediaPolicy:input.mediaPolicy,noteTemplateId:input.noteTemplateId,frequency:{every:input.every,unit:input.unit}});creators=[added,...creators];return added; };
service.setCreatorEnabled = async (id,enabled)=> { creators=creators.map(item=>item.creatorId===id?{...item,autoFetchEnabled:enabled}:item); return creators.find(item=>item.creatorId===id)!; };
service.previewCreatorSettings = async (id,input) => ({oldTimezone:creators.find(item=>item.creatorId===id)!.timezone,newTimezone:input.timezone,oldNextCheckAt:'2026-09-12T08:00:00Z',newNextCheckAt:'2026-09-13T08:00:00Z',willRunImmediately:false,previewToken:'fixture-settings-preview'});
service.updateCreatorSettings = async (id,input,token) => {
  if(token!=='fixture-settings-preview')throw new Error('Settings preview required');
  creators=creators.map(item=>item.creatorId===id?{...item,saveFolderPath:input.saveFolderPath,timezone:input.timezone,frequency:{every:input.every,unit:input.unit},preferredTimes:input.preferredTimes,noteTemplateId:input.noteTemplateId,mediaPolicy:input.mediaPolicy}:item);
  return creators.find(item=>item.creatorId===id)!;
};
service.deleteCreator = async id => {creators=creators.filter(item=>item.creatorId!==id)};
service.runScheduled = async () => ({leases:0,pages:0,saved:0,failed:0,skipped:null});
service.runCreatorNow = async () => ({leases:1,pages:1,saved:0,failed:0,skipped:null});
service.retryCreator = service.runCreatorNow;
// Canonical content from node 1233:3608, isolated from production services.
if (query.get('reference') === 'single') {
  service.account = async () => ({user:{id:'fixture', name:'Berry', email:'berry@example.com'},installationId:'fixture',subscription:{plan:'Mega',status:'active',periodEnd:null,remainingQuota:1997,totalQuota:2000,addOnBalance:0,quotaRefreshAt:null,cancelAtPeriodEnd:false,billingUrl:'https://example.com',fetchAllowed:true,fetchBlockedReason:null}});
  const originalCapabilities = service.capabilities;
  service.capabilities = async () => ({...await originalCapabilities(), plan:'Mega'});
  service.previewSingle = async () => ({post:{platform:'instagram',contentId:'reference-camera',canonicalUrl:'https://youtube.com/watch?v=…',title:'The hidden details behind a great everyday camera',text:'',author:{id:'fixture',displayName:'Marques Brownlee',handle:'studio_mori'},publishedAt:'2026-08-20',media:[{id:'landscape',kind:'image',sourceUrl:fixtureImages.thumbnail,thumbnailUrl:fixtureImages.thumbnail,tags:['article','research']}]},demo:false,fetchId:'fixture'});
  const originalPlan = service.planPreview;
  service.planPreview = async (preview, options) => ({...await originalPlan(preview,options), renderedManagedBlock:`# ${preview.post.title}

## Summary
A practical review of the camera’s real-world strengths,
with special attention to portability and everyday speed.

## Key takeaways
- Strongest in controlled light.
- Compact setup reduces travel friction.
- Battery and workflow are the key trade-offs.`});
}
if (query.get('reference') === 'account') {
  service.activity = async () => ({items:[],nextCursor:null,retainedFrom:null});
  const current = await service.account();
  service.account = async () => ({...current, user:{...current.user,name:'Berry'},subscription:{...current.subscription,plan:'Basic',remainingQuota:20,totalQuota:20}});
}
if (query.get('reference') === 'creator-failure') {
  service.parseCreator = async () => {throw new Error('Please enter a creator profile URL, not a single post URL.');};
}
if (query.get('reference') === 'bulk') {
  const account = await service.account(); service.account = async () => ({...account,user:{...account.user,name:'Berry'},subscription:{...account.subscription,plan:'Mega',remainingQuota:1997,totalQuota:2000}});
  const previousCapabilities=service.capabilities;service.capabilities=async()=>({...await previousCapabilities(),plan:'Mega'});
  const titles=['The hidden details behind a great everyday camera','--','AI in Healthcare','Sustainable Fashion Trends','The Rise of Remote Work'];
  const descriptions=['A deep dive into the standout gadgets and software that defined this year.','Are foldables finally ready for mainstream adoption?','Exploring the benefits and challenges of AI in medical diagnostics.','How eco-friendly fashion is changing the industry.','Adapting to a new normal: Trends in the remote workforce.'];
  const thumbs=Object.values(bulkImages);
  const posts=titles.map((title,index)=>({platform:'instagram',contentId:`reference-${index}`,canonicalUrl:`https://instagram.com/p/reference-${index}`,title,text:descriptions[index]!,publishedAt:new Date(Date.now()-7200000).toISOString(),author:{id:'mori',displayName:'Studio Mori',handle:'studio_mori'},media:[{id:`image-${index}`,kind:'image' as const,sourceUrl:thumbs[index]!,thumbnailUrl:thumbs[index]!},{id:`image-${index}-2`,kind:'image' as const,sourceUrl:thumbs[index]!},{id:`video-${index}`,kind:'video' as const,sourceUrl:'https://example.com/video.mp4'}]}));
  const plan=service.planPreview;service.planPreview=async(preview,options)=>({...await plan(preview,options),renderedManagedBlock:`# ${preview.post.title}

## Summary
A practical review of the camera’s real-world strengths,
with special attention to portability and everyday speed.

## Key takeaways
- Strongest in controlled light.
- Compact setup reduces travel friction.
- Battery and workflow are the key trade-offs.`});
  service.fetchProfilePage=async (_url,cursor)=>{if(cursor)throw new AgentLensError('provider_unavailable', 'Page 2 could not be loaded. Retry to fetch more.', true, 503);return {fetchId:'reference',mode:'profile_page',platform:'instagram',content:posts,page:{cursor:'page-2',hasMore:true,pageNumber:1},usage:{charged:true,units:1,remaining:1997}};};
}
if (query.get('reference') === 'save') {
  const account=await service.account();service.account=async()=>({...account,user:{...account.user,name:'Berry'},subscription:{...account.subscription,plan:'Mega',remainingQuota:1997,totalQuota:2000}});
  const cap=service.capabilities;service.capabilities=async()=>({...await cap(),plan:'Mega'});
  const titles=['The hidden details behind a great everyday camera','Capturing the essence of urban life through a lens',"Exploring nature's beauty with macro photography",'The evolution of smartphone cameras: A technical deep dive with an intentionally long title'];
  const folders=['Inspiration/Editorial Illustration','Street Photography/Urban Exploration','Nature/Macro Focus','Technology/Product Review'];
  const thumbs=Object.values(saveImages);
  const posts=titles.map((title,index)=>({platform:'instagram',contentId:`save-${index}`,canonicalUrl:`https://instagram.com/p/save-${index}`,title,text:'',author:{id:'mori',displayName:'Studio Mori'},media:[{id:`save-image-${index}`,kind:'image' as const,sourceUrl:thumbs[index]!,thumbnailUrl:thumbs[index]!}]}));
  service.previewSingle=async()=>({post:posts[0]!,fetchId:'single-save-reference',demo:false});
  service.fetchProfilePage=async()=>({fetchId:'save-reference',mode:'profile_page',platform:'instagram',content:posts,page:{cursor:null,hasMore:false,pageNumber:1},usage:{charged:true,units:1,remaining:1997}});
  const plan=service.planPreview;service.planPreview=async(preview,options)=>({...await plan(preview,options),notePath:`${folders[Number(preview.post.contentId.slice(-1))]}/${preview.post.contentId}.md`});
  service.savePrepared=async(entries,onProgress)=>{
    const successes=[];
    for(const {manifest} of entries){onProgress?.(manifest.contentKey,'Writing note · 1 attachment planned');await new Promise<void>(resolve=>window.addEventListener('fixture:next-save',()=>resolve(),{once:true}));successes.push(successfulSave(manifest));onProgress?.(manifest.contentKey,'written · 1 attachment saved');}
    return {successes,failures:[]};
  };
}
if(query.get('reference')==='auto') {
 const account=await service.account();service.account=async()=>({...account,user:{...account.user,name:'Berry'},subscription:{...account.subscription,plan:'Mega',remainingQuota:1997,totalQuota:2000}});
 const cap=service.capabilities;service.capabilities=async()=>({...await cap(),plan:'Mega'});
 const today=(hours:number,minutes:number)=>{const date=new Date();date.setHours(hours,minutes,0,0);return date.toISOString();};
 creators=['running','scheduled','retry_pending','paused'].map((state,index)=>creator({creatorId:`creator-${index}`,displayName:index===1?'不见山海工作室':'studio_mori',handle:index===1?'625165800000000032025b01':'studio_mori',platform:'instagram',avatarUrl:autoAvatar,frequency:{every:12,unit:'hour'},saveFolderPath:'Inspiration/Editorial Illustration',schedulerState:state==='paused'?'scheduled':state,autoFetchEnabled:state!=='paused',lastError:state==='retry_pending'?'Provider unavailable':null,activeJobId:state==='running'?'job':null,lastCheckedAt:new Date(Date.now()-12*60000).toISOString(),nextCheckAt:today(15,35),lastSavedAt:today(21,38),lastSavedCount:48,importedCount:48}));
}
if(query.get('reference')==='auth') {
 service.signInWithEmail=async(credentials)=>{document.documentElement.dataset.authAttempt=credentials.name===undefined?'login':'register';throw new Error('Email or password is incorrect.');};
 service.requestPasswordReset=async()=> 'If this email exists, reset instructions will be sent.';
}
if (query.get('reference') === 'feedback') {
  const single = service.previewSingle, bulk = service.fetchProfilePage;
  const wait = () => new Promise<void>(resolve => window.addEventListener('fixture:finish-parse', () => resolve(), {once:true}));
  service.previewSingle = async url => { await wait(); return single(url); };
  service.fetchProfilePage = async (url, cursor) => { await wait(); return bulk(url, cursor); };
}
// Browser substitute for the host MarkdownRenderer; text-only DOM keeps fixture markup safe.
function renderMarkdown(markdown: string, element: HTMLElement) {
  element.replaceChildren();
  for (const line of markdown.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('<dl class="agentlens-note-metadata">')) {
      const parsed = new DOMParser().parseFromString(line, 'text/html');
      const table = document.createElement('dl'); table.className = 'agentlens-note-metadata';
      for (const source of parsed.querySelectorAll('dl > div')) {
        const row = document.createElement('div');
        for (const tag of ['dt', 'dd']) { const cell = document.createElement(tag); cell.textContent = source.querySelector(tag)?.textContent ?? ''; row.append(cell); }
        table.append(row);
      }
      element.append(table); continue;
    }
    if (line.includes(': | ')) {
      if (markdown.includes('<dl class="agentlens-note-metadata">')) continue;
      let table = element.querySelector('dl');
      if (!table) { table = document.createElement('dl'); element.append(table); }
      const [label, value] = line.split(' | '); const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = label!;
      const dd = document.createElement('dd'); dd.textContent = value!;
      row.append(dt,dd); table.append(row); continue;
    }
    const item = /^- (.*)$/.exec(line);
    if (item) {
      let list = element.lastElementChild;
      if (!(list instanceof HTMLUListElement)) { list = document.createElement('ul'); element.append(list); }
      const li = document.createElement('li'); li.textContent = item[1]!; list.append(li); continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    const child = document.createElement(heading ? `h${heading[1]!.length}` : 'p');
    child.textContent = heading ? heading[2]! : line;
    element.append(child);
  }
  return () => element.replaceChildren();
}
const root = document.getElementById('root')!;
createRoot(root).render(query.get('reference') === 'timezones' ? <TimezoneReference /> : query.get('reference') === 'actions' ? <ActionReference /> : query.get('reference') === 'inputs' ? <InputReference /> : query.get('reference') === 'buttons' ? <ButtonReference /> : query.get('reference') === 'platforms' ? <section className="agentlens-workbench" aria-label="Platform icon reference" style={{width:599,height:583,minHeight:583,position:'relative',background:'#ececec'}}>{Object.keys(platformAssets).map((id,index)=><div key={id} title={id} style={{position:'absolute',left:120+index%5*88,top:92+Math.floor(index/5)*88,width:36,height:36}}><PlatformIcon id={id} /><span className="agentlens-sr-only">{id}</span></div>)}</section> : <WorkbenchApp onOpenFolder={path=>{root.dataset.openedFolder=path;}} locale="en" onOpenNote={path=>{root.dataset.openedNote=path;}} initialTab={query.get('tab') as any ?? 'single'} service={service} renderMarkdown={renderMarkdown} defaults={query.has("reference") ? {folderPath:"Inspiration/Editorial Illustration",templateId:"default",mediaPolicy:"download_all",autoEvery:4,autoUnit:"hour",autoPreferredTime:"09:00"} : undefined} vaultName={query.get('reference') === 'folder' ? 'Datebase1' : query.get('reference') === 'schedule' ? 'database#1' : 'Current Vault'} recentFolder={query.get('reference') === 'folder' ? 'Inspiration/Photography' : undefined} vaultFolderCounts={query.get('reference') === 'folder' ? {Inbox:12,Inspiration:234,'Inspiration/Social Media':56,'Inspiration/Editorial Illustration':78,'Inspiration/Photography':100,Projects:167,'Projects/Events 2026':64} : undefined} vaultFolders={query.get('reference') === 'folder' ? ['Inbox','Inspiration','Inspiration/Social Media','Inspiration/Editorial Illustration','Inspiration/Photography','Projects','Projects/Events 2026','Projects/Client Projects','Archive'] : ["AgentLens", "AgentLens/Inbox", "Research", "Research/Editorial", "Archive"]} onClose={()=>{root.textContent='Workbench closed';}} />);
