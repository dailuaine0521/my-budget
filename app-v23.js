(() => {
  'use strict';

  const STORAGE={salt:'budget_salt_v1',vault:'budget_vault_v1',kdf:'budget_kdf_v2',lastDate:'budget_last_date_v1',cloudSession:'budget_cloud_session_v1',cloudRevision:'budget_cloud_revision_v1'};
  const CLOUD={url:'https://nrooydumvpwggkrdghyv.supabase.co',key:'sb_publishable_vUn_ugwvl-tp5eUz_9UDNg_1lYC8RQ4'};
  const LEGACY_ITERATIONS=250000, STRONG_ITERATIONS=600000, IDLE_LOCK_MS=3*60*1000;
  const expenseCats=['식비','카페','편의점','교통','주거/공과금','쇼핑','여가','건강','교육','경조사','구독','기타'];
  const incomeCats=['급여','용돈/지원','부수입','환급','투자/이자','기타'];
  const mealTypes=['아침','점심','저녁','술'];
  const foodContexts=['직장','데이트','혼밥'];
  const detailMap={
    '카페':['커피','디저트','브런치/베이커리'],
    '편의점':['간편식/식사','간식/음료','생활용품'],
    '교통':['시외버스','시내버스','택시','지하철','KTX/기차','주유/충전','주차/통행료'],
    '주거/공과금':['월세/관리비','전기','가스','수도','통신비','인터넷'],
    '쇼핑':['의류','생활용품','전자기기','화장품','온라인쇼핑'],
    '여가':['영화/공연','게임','여행','취미','운동','술'],
    '건강':['병원','약국','치과','검진'],
    '교육':['도서','강의/수강료','자격증/시험','학용품'],
    '경조사':['축의금','조의금','선물'],
    '구독':['OTT','음악','클라우드/앱','멤버십']
  };
  const subDetailMap={
    '식비':['배달'],
    '여가|술':['위스키','전통주']
  };
  const catColors={'식비':'#ef4444','카페':'#92400e','편의점':'#f59e0b','교통':'#3b82f6','주거/공과금':'#8b5cf6','쇼핑':'#ec4899','여가':'#14b8a6','건강':'#22c55e','교육':'#6366f1','경조사':'#a16207','구독':'#64748b','기타':'#9ca3af'};

  let key=null,data=null,lastActivity=Date.now(),failedUnlocks=0,blockedUntil=0,activeTab='home';
  let cloudSession=null,cloudRestoreMode=false,cloudSyncing=false,cloudSyncPending=false,cloudSyncTimer=null;
  let view=new Date(); view.setDate(1);
  const $=id=>document.getElementById(id), enc=new TextEncoder(), dec=new TextDecoder();
  const bytesToB64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
  const b64ToBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const won=n=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(n)||0))+'원';
  const num=n=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(n)||0));
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const monthKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function currentKdf(){try{const raw=localStorage.getItem(STORAGE.kdf);if(!raw)return{version:1,iterations:LEGACY_ITERATIONS,hash:'SHA-256'};const p=JSON.parse(raw),i=Number(p.iterations);if(!Number.isInteger(i)||i<100000||i>2000000)throw 0;return{version:Number(p.version)||2,iterations:i,hash:'SHA-256'}}catch{return{version:1,iterations:LEGACY_ITERATIONS,hash:'SHA-256'}}}
  async function deriveKey(password,saltB64,iterations){const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:b64ToBytes(saltB64),iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
  async function encryptObject(obj,cryptoKey){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,enc.encode(JSON.stringify(obj)));return{iv:bytesToB64(iv),data:bytesToB64(cipher)}}
  async function decryptObject(vault,cryptoKey){const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(vault.iv)},cryptoKey,b64ToBytes(vault.data));return JSON.parse(dec.decode(plain))}
  async function persist(options={}){if(!data||!key)return;if(options.touch!==false)data.updatedAt=new Date().toISOString();localStorage.setItem(STORAGE.vault,JSON.stringify(await encryptObject(data,key)));if(options.sync!==false)scheduleCloudSync()}

  function localRevision(){return Number(localStorage.getItem(STORAGE.cloudRevision)||0)}
  function setLocalRevision(v){localStorage.setItem(STORAGE.cloudRevision,String(Math.max(0,Number(v)||0)))}
  function normalizedKdf(v){const p=v||currentKdf();return{version:Number(p.version)||2,iterations:Number(p.iterations)||STRONG_ITERATIONS,hash:'SHA-256'}}
  function sameCrypto(remote){const a=normalizedKdf(remote?.kdf),b=normalizedKdf(currentKdf());return remote?.salt===localStorage.getItem(STORAGE.salt)&&a.iterations===b.iterations&&a.hash===b.hash}

  function updateCloudUi(status='',kind=''){
    const signed=Boolean(cloudSession?.access_token&&cloudSession?.user?.id);
    $('cloudSignedOut')?.classList.toggle('hidden',signed);$('cloudSignedIn')?.classList.toggle('hidden',!signed);
    if(signed&&$('cloudAccountText'))$('cloudAccountText').textContent=cloudSession.user.email||cloudSession.user.id;
    const el=$('cloudSyncStatus');
    if(el){el.textContent=signed?(status||'연결됨'):'연결 안 됨';el.classList.remove('sync-ok','sync-warn','sync-error');if(kind)el.classList.add('sync-'+kind)}
    if($('cloudDetail'))$('cloudDetail').textContent=status||'동기화 준비됨';
  }

  async function cloudRequest(path,{method='GET',body,auth=true,headers={}}={}){
    const h={'apikey':CLOUD.key,...headers};
    if(body!==undefined&&!h['Content-Type'])h['Content-Type']='application/json';
    if(auth){await ensureCloudSession();if(!cloudSession?.access_token)throw new Error('클라우드 로그인이 필요합니다.');h.Authorization='Bearer '+cloudSession.access_token}
    const res=await fetch(CLOUD.url+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
    const txt=await res.text();let parsed=null;try{parsed=txt?JSON.parse(txt):null}catch{parsed=txt}
    if(!res.ok)throw new Error(String(parsed?.msg||parsed?.message||parsed?.error_description||parsed?.error||('HTTP '+res.status)));
    return parsed;
  }

  function compactSession(s){if(!s)return null;const expiresAt=Number(s.expires_at)||(s.expires_in?Math.floor(Date.now()/1000)+Number(s.expires_in):0);return{access_token:s.access_token,refresh_token:s.refresh_token,expires_at:expiresAt,token_type:s.token_type||'bearer',user:s.user?{id:s.user.id,email:s.user.email}:null}}
  async function saveCloudSessionLocal(){if(!key||!cloudSession)return;localStorage.setItem(STORAGE.cloudSession,JSON.stringify(await encryptObject(compactSession(cloudSession),key)))}
  async function restoreCloudSessionLocal(){if(!key)return false;const raw=localStorage.getItem(STORAGE.cloudSession);if(!raw)return false;try{cloudSession=await decryptObject(JSON.parse(raw),key);await ensureCloudSession();updateCloudUi('연결됨','ok');return true}catch{localStorage.removeItem(STORAGE.cloudSession);cloudSession=null;updateCloudUi();return false}}
  async function ensureCloudSession(){if(!cloudSession?.access_token)return;const exp=Number(cloudSession.expires_at||0);if(exp&&exp>Date.now()/1000+90)return;if(!cloudSession.refresh_token){cloudSession=null;return}const next=await cloudRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:cloudSession.refresh_token},auth:false});cloudSession=compactSession(next);if(key)await saveCloudSessionLocal()}

  async function cloudFetchVault(){if(!cloudSession?.user?.id)return null;const rows=await cloudRequest('/rest/v1/budget_vaults?select=salt,kdf,vault,revision,updated_at&user_id=eq.'+encodeURIComponent(cloudSession.user.id));return Array.isArray(rows)&&rows.length?rows[0]:null}
  async function cloudWriteVault(expectedRevision){
    const vault=JSON.parse(localStorage.getItem(STORAGE.vault)||'null'),salt=localStorage.getItem(STORAGE.salt);
    if(!vault||!salt)throw new Error('로컬 가계부가 없습니다.');
    const expected=Math.max(0,Number(expectedRevision)||0),next=expected+1;
    const payload={user_id:cloudSession.user.id,salt,kdf:normalizedKdf(currentKdf()),vault,revision:next,updated_at:new Date().toISOString()};
    let rows;
    if(expected===0){
      try{rows=await cloudRequest('/rest/v1/budget_vaults',{method:'POST',body:payload,headers:{Prefer:'return=representation'}})}
      catch(e){if(String(e?.message||'').toLowerCase().includes('duplicate')){const err=new Error('SYNC_CONFLICT');err.code='SYNC_CONFLICT';throw err}throw e}
    }else{
      rows=await cloudRequest('/rest/v1/budget_vaults?user_id=eq.'+encodeURIComponent(cloudSession.user.id)+'&revision=eq.'+expected,{method:'PATCH',body:payload,headers:{Prefer:'return=representation'}});
      if(!Array.isArray(rows)||rows.length===0){const err=new Error('SYNC_CONFLICT');err.code='SYNC_CONFLICT';throw err}
    }
    const saved=Array.isArray(rows)&&rows[0]?rows[0]:payload;setLocalRevision(saved.revision||next);return saved
  }

  function mergeData(localData,remoteData){
    const l=JSON.parse(JSON.stringify(localData||{})),r=JSON.parse(JSON.stringify(remoteData||{})),tomb=new Map(),tx=new Map();
    [...(r.deletedTransactions||[]),...(l.deletedTransactions||[])].forEach(x=>{if(!x?.id)return;const old=tomb.get(x.id);if(!old||String(x.deletedAt||'')>String(old.deletedAt||''))tomb.set(x.id,x)});
    [...(r.transactions||[]),...(l.transactions||[])].forEach(x=>{if(!x?.id)return;const old=tx.get(x.id);if(!old||String(x.updatedAt||x.createdAt||'')>=String(old.updatedAt||old.createdAt||''))tx.set(x.id,x)});
    for(const [id,d] of tomb){const item=tx.get(id);if(item&&String(d.deletedAt||'')>=String(item.updatedAt||item.createdAt||''))tx.delete(id)}
    const ls=String(l.settingsUpdatedAt||l.createdAt||''),rs=String(r.settingsUpdatedAt||r.createdAt||''),profiles={...(r.merchantProfiles||{})};
    for(const [name,p] of Object.entries(l.merchantProfiles||{})){const old=profiles[name];if(!old||String(p?.updatedAt||'')>=String(old?.updatedAt||''))profiles[name]=p}
    return{...r,...l,version:12,createdAt:[l.createdAt,r.createdAt].filter(Boolean).sort()[0]||new Date().toISOString(),updatedAt:[l.updatedAt,r.updatedAt].filter(Boolean).sort().slice(-1)[0]||new Date().toISOString(),settings:(window.BudgetFeatures?.mergeSettings?.(l.settings||{},r.settings||{},ls>=rs?(l.settings||{}):(r.settings||{}))??(ls>=rs?(l.settings||{}):(r.settings||{}))),settingsUpdatedAt:ls>=rs?ls:rs,merchantProfiles:profiles,transactions:[...tx.values()],deletedTransactions:[...tomb.values()].slice(-1000)};
  }

  async function installRemoteVault(remote){if(!remote?.vault||!remote?.salt)throw new Error('클라우드 가계부가 비어 있습니다.');localStorage.setItem(STORAGE.salt,remote.salt);localStorage.setItem(STORAGE.kdf,JSON.stringify(normalizedKdf(remote.kdf)));localStorage.setItem(STORAGE.vault,JSON.stringify(remote.vault));localStorage.removeItem(STORAGE.cloudSession);setLocalRevision(remote.revision||0);key=null;data=null;$('cloudOverlay')?.classList.add('hidden');showOnly('locked');toast('클라우드 가계부를 불러왔습니다. 가계부 암호화 비밀번호로 열어주세요.',4200)}

  async function syncCloudNow(reason='manual'){
    if(!cloudSession||!key||!data)return;if(cloudSyncing){cloudSyncPending=true;return}cloudSyncing=true;cloudSyncPending=false;updateCloudUi('동기화 중…','warn');
    try{
      await ensureCloudSession();
      let synced=false;
      for(let attempt=0;attempt<4&&!synced;attempt++){
        const remote=await cloudFetchVault();
        if(!remote){
          try{await cloudWriteVault(0);synced=true;break}catch(e){if(e?.code==='SYNC_CONFLICT')continue;throw e}
        }
        if(!sameCrypto(remote))throw new Error('다른 기기에서 가계부 비밀번호가 변경되었습니다.');
        const remoteData=await decryptObject(remote.vault,key);
        data=mergeData(data,remoteData);ensureDataShape();setLocalRevision(remote.revision||0);
        await persist({sync:false,touch:false});
        try{await cloudWriteVault(Number(remote.revision)||0);synced=true}
        catch(e){if(e?.code==='SYNC_CONFLICT')continue;throw e}
      }
      if(!synced)throw new Error('동시에 변경된 내용이 많아 동기화를 다시 시도해야 합니다.');
      renderAll();updateCloudUi('방금 동기화됨','ok');
    }catch(e){updateCloudUi(e?.message||'동기화 실패','error');if(reason==='manual')toast(e?.message||'동기화에 실패했습니다.',3500)}
    finally{cloudSyncing=false;if(cloudSyncPending){cloudSyncPending=false;scheduleCloudSync(300)}}
  }
  function scheduleCloudSync(delay=700){if(!cloudSession||!key||!data)return;clearTimeout(cloudSyncTimer);cloudSyncTimer=setTimeout(()=>syncCloudNow('auto'),delay)}
  async function onAppOpened(){try{if(cloudSession){await saveCloudSessionLocal();updateCloudUi('연결됨','ok');await syncCloudNow('open');return}if(await restoreCloudSessionLocal())await syncCloudNow('open');else updateCloudUi()}catch(e){updateCloudUi(e?.message||'동기화 연결 확인 필요','warn')}}
  function openCloudOverlay(restoreMode=false){cloudRestoreMode=restoreMode;$('cloudOverlay').classList.remove('hidden');updateCloudUi(cloudSession?'연결됨':'',cloudSession?'ok':'');if(!cloudSession)setTimeout(()=>$('cloudEmail')?.focus(),80)}

  async function acceptCloudSession(raw){
    cloudSession=compactSession(raw);if(!cloudSession?.access_token||!cloudSession?.user?.id)throw new Error('로그인 세션을 만들지 못했습니다.');if(key)await saveCloudSessionLocal();updateCloudUi('연결됨','ok');
    if(cloudRestoreMode){const remote=await cloudFetchVault();if(!remote)throw new Error('이 계정에 저장된 가계부가 없습니다.');await installRemoteVault(remote);cloudRestoreMode=false;return}
    const remote=await cloudFetchVault();if(!remote){await cloudWriteVault(0);updateCloudUi('첫 동기화 완료','ok');toast('클라우드 동기화를 연결했습니다.')}else if(sameCrypto(remote)){await syncCloudNow('manual');toast('기기 간 동기화를 연결했습니다.')}else{updateCloudUi('기존 클라우드 가계부 발견','warn');toast('클라우드에 다른 암호화 가계부가 있습니다. 필요하면 “클라우드 데이터로 이 기기 교체”를 사용하세요.',4500)}
  }

  async function cloudLogin(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||!password)return toast('이메일과 클라우드 계정 비밀번호를 입력하세요.');try{updateCloudUi('로그인 중…','warn');const session=await cloudRequest('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false});$('cloudPassword').value='';await acceptCloudSession(session)}catch(e){updateCloudUi();toast('클라우드 로그인 실패: '+(e?.message||''),3800)}}
  async function cloudRegister(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<8)return toast('이메일과 8자 이상의 클라우드 계정 비밀번호를 입력하세요.');try{updateCloudUi('계정 생성 중…','warn');const redirectTo='https://dailuaine0521.github.io/my-budget/';const result=await cloudRequest('/auth/v1/signup?redirect_to='+encodeURIComponent(redirectTo),{method:'POST',body:{email,password},auth:false});$('cloudPassword').value='';if(result?.access_token)await acceptCloudSession(result);else{updateCloudUi();toast('계정을 만들었습니다. 확인 메일이 오면 인증한 뒤 로그인하세요.',5000)}}catch(e){updateCloudUi();toast('계정 생성 실패: '+(e?.message||''),4000)}}
  async function cloudReplaceCurrent(){if(!cloudSession)return;if(!confirm('이 기기의 현재 가계부를 클라우드 버전으로 교체할까요? 아직 동기화하지 않은 로컬 변경은 사라질 수 있으니 필요하면 먼저 암호화 백업을 저장하세요.'))return;try{const remote=await cloudFetchVault();if(!remote)throw new Error('클라우드 가계부가 없습니다.');await installRemoteVault(remote)}catch(e){toast(e?.message||'클라우드 데이터를 불러오지 못했습니다.',3500)}}
  async function disconnectCloud(){if(!confirm('이 기기에서 클라우드 동기화를 해제할까요? Supabase에 저장된 암호화 가계부는 삭제되지 않습니다.'))return;try{if(cloudSession?.access_token)await cloudRequest('/auth/v1/logout',{method:'POST',body:{},auth:true})}catch{}cloudSession=null;localStorage.removeItem(STORAGE.cloudSession);localStorage.removeItem(STORAGE.cloudRevision);updateCloudUi();$('cloudOverlay').classList.add('hidden');toast('이 기기의 동기화 연결을 해제했습니다.')}

  function showOnly(id){['setup','locked','app'].forEach(x=>$(x).classList.add('hidden'));$(id).classList.remove('hidden')}
  function toast(message,ms=2200){$('toast').textContent=message;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),ms)}
  function noteActivity(){lastActivity=Date.now()}
  function passwordIsStrong(p){if(p.length<10||p.length>64)return false;return (/\p{L}/u.test(p)&&/\p{N}/u.test(p))||p.length>=14}
  function passwordHint(){return '10~64자로 입력하세요. 문자+숫자를 함께 쓰거나 14자 이상의 긴 암호문구를 사용하세요.'}
  function ensureDataShape(){
    if(!Array.isArray(data.transactions))data.transactions=[];
    if(!data.settings||typeof data.settings!=='object')data.settings={};
    if(!Number.isFinite(Number(data.settings.monthlyBudget)))data.settings.monthlyBudget=0;
    if(!Number.isFinite(Number(data.settings.localPaybackRate)))data.settings.localPaybackRate=0;
    if(!Number.isFinite(Number(data.settings.investmentBudget)))data.settings.investmentBudget=0;
    if(!Array.isArray(data.settings.investmentPlans))data.settings.investmentPlans=[];
    data.settings.investmentPlans=data.settings.investmentPlans.filter(p=>p&&p.id&&p.targetDate&&Number(p.amount)>0).map(p=>({...p,amount:Number(p.amount),status:p.status==='done'?'done':'planned'}));
    if(!Array.isArray(data.settings.budgetRules))data.settings.budgetRules=[];
    data.settings.budgetRules=data.settings.budgetRules.filter(r=>r&&Number(r.amount)>0&&r.type&&r.label).map(r=>({...r,amount:Number(r.amount)}));
    if(!data.merchantProfiles||typeof data.merchantProfiles!=='object')data.merchantProfiles={};
    if(!Array.isArray(data.deletedTransactions))data.deletedTransactions=[];
    if(!data.settingsUpdatedAt)data.settingsUpdatedAt=data.createdAt||new Date().toISOString();
    if(!data.updatedAt)data.updatedAt=data.createdAt||new Date().toISOString();
    data.version=12;
  }

  async function setup(){const first=$('p1').value,second=$('p2').value;if(!passwordIsStrong(first))return toast(passwordHint(),3500);if(first!==second)return toast('두 비밀번호가 서로 다릅니다.');const salt=bytesToB64(crypto.getRandomValues(new Uint8Array(16)));key=await deriveKey(first,salt,STRONG_ITERATIONS);data={version:12,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),settingsUpdatedAt:new Date().toISOString(),transactions:[],deletedTransactions:[],settings:{monthlyBudget:0,budgetRules:[],localPaybackRate:0,investmentBudget:0,investmentPlans:[]},merchantProfiles:{}};localStorage.setItem(STORAGE.salt,salt);localStorage.setItem(STORAGE.kdf,JSON.stringify({version:2,iterations:STRONG_ITERATIONS,hash:'SHA-256'}));await persist();$('p1').value=$('p2').value='';openApp()}
  async function unlock(){const now=Date.now();if(now<blockedUntil)return toast(`잠시 후 다시 시도하세요. ${Math.ceil((blockedUntil-now)/1000)}초`);try{const salt=localStorage.getItem(STORAGE.salt),rawVault=localStorage.getItem(STORAGE.vault);if(!salt||!rawVault)return showOnly('setup');const candidate=await deriveKey($('upin').value,salt,currentKdf().iterations);data=await decryptObject(JSON.parse(rawVault),candidate);ensureDataShape();key=candidate;failedUnlocks=0;blockedUntil=0;$('upin').value='';openApp()}catch{failedUnlocks++;if(failedUnlocks>=5){blockedUntil=Date.now()+30000;failedUnlocks=0;toast('실패가 반복되어 30초 동안 잠깁니다.',3500)}else toast('비밀번호가 올바르지 않습니다.')}}
  function openApp(){showOnly('app');view=new Date();view.setDate(1);activeTab='home';switchTab('home');noteActivity();renderAll();onAppOpened()}
  function lockNow(message=''){key=null;data=null;cloudSession=null;['settingsOverlay','txOverlay','passwordOverlay','budgetOverlay','categoryBudgetOverlay','localPaybackOverlay','cloudOverlay','fixedOverlay','templateOverlay','assetOverlay','categoryDrillOverlay'].forEach(id=>$(id)?.classList.add('hidden'));showOnly('locked');$('legacyNotice').classList.toggle('hidden',Boolean(localStorage.getItem(STORAGE.kdf)));if(message)toast(message)}

  function currentMonthTransactions(){const m=monthKey(view);return [...data.transactions].filter(t=>t.date?.startsWith(m)).sort((a,b)=>b.date.localeCompare(a.date)||(b.updatedAt||'').localeCompare(a.updatedAt||''))}
  function previousMonthTransactions(){const d=new Date(view.getFullYear(),view.getMonth()-1,1),m=monthKey(d);return data.transactions.filter(t=>t.date?.startsWith(m))}
  function totals(tx){const income=tx.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0),expense=tx.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);return{income,expense,balance:income-expense}}
  function totalsByCategory(tx){const out={};tx.filter(t=>t.type==='expense').forEach(t=>out[t.category]=(out[t.category]||0)+Number(t.amount||0));return out}
  function detailTotals(tx){const out={};tx.filter(t=>t.type==='expense'&&(t.detail||t.subDetail)).forEach(t=>{const k=[t.category,t.detail,t.subDetail].filter(Boolean).join(' · ');out[k]=(out[k]||0)+Number(t.amount||0)});return out}
  function renderAll(){if(!data)return;window.BudgetFeatures?.beforeRender?.();$('monthLabel').textContent=`${view.getFullYear()}년 ${view.getMonth()+1}월`;const tx=currentMonthTransactions();renderHome(tx);renderHistory(tx);renderAnalysis();renderInvestment();window.BudgetFeatures?.render?.();}

  function renderHome(tx){
    const {expense}=totals(tx),budget=Number(data.settings.monthlyBudget||0),today=new Date(),isCurrent=view.getFullYear()===today.getFullYear()&&view.getMonth()===today.getMonth();
    const daysInMonth=new Date(view.getFullYear(),view.getMonth()+1,0).getDate(),elapsed=isCurrent?today.getDate():daysInMonth,dailyAvg=elapsed?expense/elapsed:0,forecast=Math.round(dailyAvg*daysInMonth);
    const spentDays=new Set(tx.filter(t=>t.type==='expense'&&t.amount>0).map(t=>t.date)).size,noSpend=Math.max(0,elapsed-spentDays);
    $('homeExpense').textContent=won(expense);$('dailyAverage').textContent=won(dailyAvg);$('monthForecast').textContent=won(forecast);$('noSpendDays').textContent=`${noSpend}일`;
    if(budget>0){const remaining=budget-expense,pct=clamp(expense/budget*100,0,100);$('budgetRemaining').textContent=remaining>=0?won(remaining):`${won(Math.abs(remaining))} 초과`;$('budgetRemaining').classList.toggle('negative',remaining<0);$('budgetProgress').classList.remove('hidden');$('budgetProgress').querySelector('span').style.width=`${pct}%`;const dailyLeft=isCurrent&&remaining>0?remaining/Math.max(1,daysInMonth-today.getDate()+1):0;$('budgetMeta').textContent=remaining>=0?(isCurrent?`하루 약 ${won(dailyLeft)}까지 쓰면 예산 안에 들어와요. 월말 예상 ${won(forecast)}.`:`예산 ${won(budget)} 중 ${won(expense)} 사용`):`예산 ${won(budget)}을 ${won(Math.abs(remaining))} 넘겼어요.`}else{$('budgetRemaining').textContent='예산을 설정해보세요';$('budgetRemaining').classList.remove('negative');$('budgetProgress').classList.add('hidden');$('budgetMeta').textContent='월 예산을 정하면 남은 금액과 월말 예상지출을 보여드려요.'}
    const todayKey=ymd(today),todaySpend=tx.filter(t=>t.type==='expense'&&t.date===todayKey).reduce((s,t)=>s+t.amount,0),avgBeforeToday=Math.max(1,elapsed-1),beforeSpend=tx.filter(t=>t.type==='expense'&&t.date<todayKey).reduce((s,t)=>s+t.amount,0),beforeAvg=beforeSpend/avgBeforeToday;
    let insight=`오늘 ${won(todaySpend)} 썼어요.`;if(isCurrent&&elapsed>1){const diff=todaySpend-beforeAvg;insight+=diff>0?` 평소보다 ${won(diff)} 더 썼어요.`:` 평소보다 ${won(Math.abs(diff))} 적게 썼어요.`}$('todayInsight').textContent=insight;
    renderComparison(tx);renderBudgetSummary(tx);renderRecent(tx);
  }

  function renderComparison(tx){const currentExpense=totals(tx).expense,prev=previousMonthTransactions(),prevExpense=totals(prev).expense,card=$('compareCard');if(!prevExpense){card.innerHTML='<b>지난달 비교</b><span>지난달 데이터가 쌓이면 같은 기간 소비 차이를 보여드려요.</span>';return}const today=new Date(),isCurrent=view.getFullYear()===today.getFullYear()&&view.getMonth()===today.getMonth(),cutoff=isCurrent?today.getDate():31,prevSame=prev.filter(t=>t.type==='expense'&&Number(t.date.slice(-2))<=cutoff).reduce((s,t)=>s+t.amount,0),diff=currentExpense-prevSame;card.innerHTML=`<b>지난달 같은 기간보다</b><strong class="${diff>0?'warn':'saving'}">${diff>0?'+':'−'}${won(Math.abs(diff))}</strong><span>${diff>0?'더 쓰고 있어요.':'덜 쓰고 있어요.'}</span>`}
  function renderRecent(tx){const box=$('recentList'),recent=tx.slice(0,5);if(!recent.length){box.innerHTML='<div class="empty compact">아직 기록이 없습니다.</div>';return}box.innerHTML=recent.map(transactionRowHtml).join('');box.querySelectorAll('[data-tx-id]').forEach(el=>el.addEventListener('click',()=>{const t=data.transactions.find(x=>x.id===el.dataset.txId);if(t)openTx(t.type,t)}))}

  function budgetTargetOptions(){
    const opts=[];
    expenseCats.forEach(category=>opts.push({value:`category|${category}`,label:category,type:'category',category}));
    mealTypes.forEach(meal=>opts.push({value:`meal|${meal}`,label:`식비 · ${meal}`,type:'meal',category:'식비',meal}));
    foodContexts.forEach(foodContext=>opts.push({value:`foodContext|${foodContext}`,label:`식비 · ${foodContext}`,type:'foodContext',category:'식비',foodContext}));
    Object.entries(detailMap).forEach(([category,details])=>details.forEach(detail=>opts.push({value:`detail|${category}|${detail}`,label:`${category} · ${detail}`,type:'detail',category,detail})));
    Object.entries(subDetailMap).forEach(([key,items])=>{const [category,detail='']=key.split('|');items.forEach(subDetail=>opts.push({value:`subDetail|${category}|${detail}|${subDetail}`,label:[category,detail,subDetail].filter(Boolean).join(' · '),type:'subDetail',category,detail,subDetail}))});
    return opts;
  }
  function parseBudgetTarget(value){return budgetTargetOptions().find(o=>o.value===value)||null}
  function ruleMatches(rule,t){if(t.type!=='expense')return false;if(rule.type==='category')return t.category===rule.category;if(rule.type==='detail')return t.category===rule.category&&t.detail===rule.detail;if(rule.type==='subDetail')return t.category===rule.category&&(!rule.detail||t.detail===rule.detail)&&t.subDetail===rule.subDetail;if(rule.type==='meal')return t.category==='식비'&&t.meal===rule.meal;if(rule.type==='foodContext')return t.category==='식비'&&t.foodContext===rule.foodContext;return false}
  function budgetRuleSpend(rule,tx){return tx.filter(t=>ruleMatches(rule,t)).reduce((s,t)=>s+Number(t.amount||0),0)}
  function budgetStatus(rule,tx){const spent=budgetRuleSpend(rule,tx),amount=Number(rule.amount||0),ratio=amount>0?spent/amount:0;return{...rule,spent,ratio,remaining:amount-spent}}
  function renderBudgetSummary(tx){const box=$('categoryBudgetSummary'),rules=data.settings.budgetRules||[];if(!rules.length){box.innerHTML='<div class="budget-empty">카페·택시·데이트처럼 항목별 예산을 정해보세요.</div>';return}const statuses=rules.map(r=>budgetStatus(r,tx)).sort((a,b)=>b.ratio-a.ratio);box.innerHTML=statuses.slice(0,4).map(s=>budgetRowHtml(s,true)).join('')+(statuses.length>4?`<button class="budget-more" id="budgetMoreBtn">${statuses.length-4}개 더 보기</button>`:'');$('budgetMoreBtn')?.addEventListener('click',openCategoryBudget)}
  function budgetRowHtml(s,compact=false){
    const pct=Math.round(s.ratio*100),bar=clamp(pct,0,100),state=s.ratio>=1?'over':s.ratio>=.8?'warned':'ok',
      caption=s.ratio>=1?`${won(Math.abs(s.remaining))} 초과`:`${won(Math.max(0,s.remaining))} 남음`,
      color=state==='over'?'#ef4444':state==='warned'?'#f59f24':'#3182f6';
    // Render an actual SVG rectangle, not a CSS-width span. The SVG viewBox
    // maps 100 units to 100% and is immune to old .budget-track span styles.
    return `<div class="budget-row ${state}">
      <div class="budget-row-head"><span>${esc(s.label)}</span><b>${pct}%</b></div>
      <div class="budget-meter-svg" role="progressbar" aria-label="${esc(s.label)} 예산 사용률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${bar}" aria-valuetext="${pct}% 사용"
        style="background-image:linear-gradient(to right,${color} ${bar}%,#edf1f4 ${bar}%);">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10" aria-hidden="true" focusable="false" style="display:block;width:100%;height:10px;">
          <rect x="0" y="0" width="100" height="10" fill="#edf1f4"></rect>
          <rect x="0" y="0" width="${bar}" height="10" fill="${color}"></rect>
        </svg>
      </div>
      <div class="budget-row-foot"><span>${won(s.spent)} / ${won(s.amount)}</span><span>${caption}</span></div>
      ${compact?'':''}
    </div>`;
  }
  function renderCategoryBudgetManager(){const select=$('categoryBudgetTarget'),current=select.value;select.innerHTML='<option value="">예산을 정할 항목 선택</option>'+budgetTargetOptions().map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');if([...select.options].some(o=>o.value===current))select.value=current;const tx=currentMonthTransactions(),list=$('categoryBudgetList'),rules=data.settings.budgetRules||[];list.innerHTML=rules.length?rules.map((r,i)=>{const s=budgetStatus(r,tx);return `<div class="budget-manager-item">${budgetRowHtml(s)}<button type="button" class="budget-delete" data-budget-delete="${i}">삭제</button></div>`}).join(''):'<div class="empty compact">설정된 항목별 예산이 없습니다.</div>';list.querySelectorAll('[data-budget-delete]').forEach(btn=>btn.addEventListener('click',()=>deleteBudgetRule(Number(btn.dataset.budgetDelete))))}
  function openCategoryBudget(){renderCategoryBudgetManager();$('categoryBudgetAmount').value='';$('categoryBudgetOverlay').classList.remove('hidden')}
  async function addBudgetRule(){const target=parseBudgetTarget($('categoryBudgetTarget').value),amount=Number($('categoryBudgetAmount').value);if(!target)return toast('예산을 정할 항목을 선택하세요.');if(!Number.isFinite(amount)||amount<=0)return toast('예산 금액을 입력하세요.');const rule={id:crypto.randomUUID(),type:target.type,label:target.label,category:target.category||'',detail:target.detail||'',subDetail:target.subDetail||'',meal:target.meal||'',foodContext:target.foodContext||'',amount};const sameIndex=data.settings.budgetRules.findIndex(r=>r.type===rule.type&&r.category===rule.category&&(r.detail||'')===rule.detail&&(r.subDetail||'')===rule.subDetail&&(r.meal||'')===rule.meal&&(r.foodContext||'')===rule.foodContext);if(sameIndex>=0){rule.id=data.settings.budgetRules[sameIndex].id||rule.id;data.settings.budgetRules[sameIndex]=rule}else data.settings.budgetRules.push(rule);data.settingsUpdatedAt=new Date().toISOString();await persist();$('categoryBudgetAmount').value='';renderCategoryBudgetManager();renderAll();toast(sameIndex>=0?'예산을 수정했습니다.':'항목별 예산을 추가했습니다.')}
  async function deleteBudgetRule(index){if(index<0||index>=data.settings.budgetRules.length)return;data.settings.budgetRules.splice(index,1);data.settingsUpdatedAt=new Date().toISOString();await persist();renderCategoryBudgetManager();renderAll();toast('항목별 예산을 삭제했습니다.')}

  function renderHistory(tx){$('historyCount').textContent=`${tx.length}건`;renderCategorySummary(tx);renderCalendar(tx);renderList(tx)}
  let categoryDrillReturnFocus=null;
  function categoryDrillSummary(all,selectedMonth,category){
  const rows=(all||[]).filter(t=>t?.type==='expense'&&t.category===category&&String(t.date||'').startsWith(selectedMonth));
  const groups=new Map(),total=rows.reduce((n,t)=>n+(Number(t.amount)||0),0);
  for(const t of rows){
    const label=category==='식비'?(t.meal||'식사 구분 없음'):(t.detail||t.subDetail||'세부 분류 없음');
    if(!groups.has(label))groups.set(label,{label,amount:0,items:[]});
    const group=groups.get(label);
    group.amount+=Number(t.amount)||0;
    group.items.push(t);
  }
  return{total,count:rows.length,groups:[...groups.values()].sort((a,b)=>b.amount-a.amount||a.label.localeCompare(b.label))};
}
  function closeCategoryDrill(){
  $('categoryDrillOverlay').classList.add('hidden');
  if(categoryDrillReturnFocus?.isConnected)categoryDrillReturnFocus.focus();
  categoryDrillReturnFocus=null;
}
  function openCategoryDrill(category,trigger){
  if(!data)return;
  const all=categoryDrillSummary(data.transactions,monthKey(view),category);
  if(!all.count)return;
  categoryDrillReturnFocus=trigger||null;
  $('categoryDrillTitle').textContent=category+' 세부 지출';
  $('categoryDrillPeriod').textContent=`${view.getFullYear()}년 ${view.getMonth()+1}월`;
  $('categoryDrillTotal').textContent=won(all.total);
  $('categoryDrillCount').textContent=`총 ${all.count}건`;
  const known=detailMap[category]||[];
  if(category==='교통'&&!all.groups.some(g=>g.label==='택시'))all.groups.push({label:'택시',amount:0,items:[]});
  const labels=new Set(all.groups.map(g=>g.label));
  // Category totals always reconcile: unsorted/legacy records are shown under '세부 분류 없음'.
  const html=all.groups.map(g=>{
    const rate=all.total?Math.round(g.amount/all.total*100):0;
    if(!g.items.length)return `<div class="drill-zero-row"><div><strong>${esc(g.label)}</strong><small>해당 분류로 기록된 내역 없음</small></div><b>${won(g.amount)}</b></div>`;
    const subs=new Map();
    for(const t of g.items)if(t.subDetail){subs.set(t.subDetail,(subs.get(t.subDetail)||0)+(Number(t.amount)||0))}
    const inner=[...subs].sort((a,b)=>b[1]-a[1]).map(([name,value])=>`<div class="drill-subdetail"><span>↳ ${esc(name)} <small>(2차 분류)</small></span><b>${won(value)}</b></div>`).join('');
    const tx=g.items.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t=>`<button type="button" class="drill-transaction" data-drill-tx="${esc(t.id)}"><span><b>${esc(t.title||t.category)}</b><small>${esc(t.date)}${t.subDetail?' · '+esc(t.subDetail):''}</small></span><strong>${won(t.amount)}</strong></button>`).join('');
    return `<details class="drill-group"><summary><div class="drill-group-name"><strong>${esc(g.label)}</strong><small>${g.items.length}건 · 전체의 ${rate}%</small></div><b>${won(g.amount)}</b><span class="drill-chevron" aria-hidden="true">⌄</span></summary><div class="drill-meter"><span style="width:${Math.min(100,Math.max(0,all.total?g.amount/all.total*100:0))}%"></span></div>${inner}<div class="drill-transactions">${tx}</div></details>`;
  }).join('');
  $('categoryDrillRows').innerHTML=html;
  let extra='';
  if(category==='식비'){
    const m=new Map();
    for(const t of data.transactions.filter(t=>t.type==='expense'&&t.category==='식비'&&String(t.date||'').startsWith(monthKey(view)))){
      const k=t.foodContext||'식사 상황 없음';
      m.set(k,(m.get(k)||0)+(Number(t.amount)||0));
    }
    if(m.size)extra=`<div class="drill-extra"><h3>식사 상황별 금액</h3><p>위 식사 구분과 별개로 집계한 금액입니다.</p>${[...m].sort((a,b)=>b[1]-a[1]).map(([label,amount])=>`<div><span>${esc(label)}</span><b>${won(amount)}</b></div>`).join('')}</div>`;
  }
  $('categoryDrillExtra').innerHTML=extra;
  $('categoryDrillOverlay').classList.remove('hidden');
  $('categoryDrillClose').focus();
}

  function renderCategorySummary(tx){const totalsMap=totalsByCategory(tx),entries=Object.entries(totalsMap).sort((a,b)=>b[1]-a[1]),box=$('categorySummary');box.innerHTML=entries.length?entries.map(([c,v])=>`<button type="button" class="cat-row category-drill-trigger" data-category-drill="${esc(c)}" aria-label="${esc(c)} 세부 지출 내역 보기"><span class="cat-dot" style="background:${catColors[c]||'#9ca3af'}"></span><span class="cat-name">${esc(c)}</span><b>${won(v)}</b><span class="drill-chevron" aria-hidden="true">›</span></button>`).join(''):'<div class="empty compact">아직 지출이 없습니다.</div>'}
  function renderCalendar(tx){const box=$('calendar'),year=view.getFullYear(),month=view.getMonth(),firstDay=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate(),dayTotals={};tx.filter(t=>t.type==='expense').forEach(t=>{const d=Number(t.date.slice(-2));dayTotals[d]=(dayTotals[d]||0)+t.amount});const max=Math.max(1,...Object.values(dayTotals));let html='<div class="cal-head">'+['일','월','화','수','목','금','토'].map(d=>`<span>${d}</span>`).join('')+'</div><div class="cal-grid">';for(let i=0;i<firstDay;i++)html+='<div class="cal-cell blank"></div>';for(let d=1;d<=days;d++){const amount=dayTotals[d]||0,intensity=amount?Math.max(.12,amount/max):0;html+=`<button class="cal-cell" data-day="${d}" style="${amount?`background:rgba(239,68,68,${.08+intensity*.16})`:''}"><span class="cal-day">${d}</span>${amount?`<span class="cal-amt">${num(amount)}</span>`:'<span class="no-spend-dot">·</span>'}</button>`}html+='</div>';box.innerHTML=html;box.querySelectorAll('[data-day]').forEach(btn=>btn.addEventListener('click',()=>{const date=`${year}-${pad(month+1)}-${pad(Number(btn.dataset.day))}`,target=document.querySelector(`[data-date="${date}"]`);if(target)target.scrollIntoView({behavior:'smooth',block:'start'});else toast('이 날짜에는 기록이 없습니다.')}))}
  function txMeta(t){return [t.category,t.meal,t.foodContext,t.detail,t.subDetail,t.payment].filter(Boolean).join(' · ')}
  function transactionRowHtml(t){const sign=t.type==='expense'?'-':'+',color=t.type==='expense'?(catColors[t.category]||'#9ca3af'):'#059669';return `<button class="tx" data-tx-id="${esc(t.id)}"><span class="dot" style="background:${color}"></span><span class="txm"><span class="txn">${esc(t.title||t.category)}</span><span class="meta">${esc(txMeta(t))}</span></span><span class="amt ${t.type}">${sign}${won(t.amount)}</span></button>`}
  function renderList(tx){const box=$('list'),groups={};tx.forEach(t=>(groups[t.date]??=[]).push(t));if(!tx.length){box.innerHTML='<div class="empty">이 달에 기록된 내역이 없습니다.</div>';return}box.innerHTML=Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(date=>{const d=new Date(date+'T00:00:00'),weekday=['일','월','화','수','목','금','토'][d.getDay()],daily=groups[date].filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);return `<div data-date="${date}"><div class="day"><span>${d.getMonth()+1}월 ${d.getDate()}일 (${weekday})</span><b>${daily?won(daily):''}</b></div>${groups[date].map(transactionRowHtml).join('')}</div>`}).join('');box.querySelectorAll('[data-tx-id]').forEach(el=>el.addEventListener('click',()=>{const t=data.transactions.find(x=>x.id===el.dataset.txId);if(t)openTx(t.type,t)}))}
  function switchTab(tab){activeTab=tab;['home','history','analysis','investment'].forEach(name=>$(name+'Panel').classList.toggle('active',name===tab));document.querySelectorAll('.nav-btn[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));if(tab==='analysis')renderAnalysis();if(tab==='investment')renderInvestment();window.scrollTo({top:0,behavior:'smooth'})}

  function shiftDateInput(id,days){
    const input=$(id);if(!input)return;
    const base=/^\d{4}-\d{2}-\d{2}$/.test(input.value||'')?new Date(input.value+'T12:00:00'):new Date();
    base.setDate(base.getDate()+days);input.value=ymd(base);input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function investmentMonthPlans(){
    const m=monthKey(view);
    return (data.settings.investmentPlans||[]).filter(p=>String(p.targetDate||'').startsWith(m)).sort((a,b)=>a.targetDate.localeCompare(b.targetDate)||(a.createdAt||'').localeCompare(b.createdAt||''));
  }
  function renderInvestment(){
    if(!data||!$('investmentPanel'))return;
    const budget=(window.BudgetFeatures?.monthlyInvestmentBudget?.(monthKey(view),data)??Number(data.settings.investmentBudget||0)),plans=investmentMonthPlans();
    const planned=plans.reduce((s,p)=>s+Number(p.amount||0),0);
    const done=plans.filter(p=>p.status==='done').reduce((s,p)=>s+Number(p.amount||0),0);
    const remaining=budget-planned;
    $('investBudgetValue').textContent=budget?won(budget):'예산 미설정';
    $('investPlannedValue').textContent=won(planned);
    $('investDoneValue').textContent=won(done);
    $('investRemainingValue').textContent=budget?(remaining>=0?won(remaining):won(Math.abs(remaining))+' 초과'):'-';
    $('investRemainingValue').classList.toggle('warn',budget>0&&remaining<0);
    const pct=budget>0?clamp(planned/budget*100,0,100):0;
    $('investProgress').classList.toggle('hidden',budget<=0);
    $('investProgress').querySelector('span').style.width=pct+'%';
    $('investBudgetMeta').textContent=budget>0?'계획 '+won(planned)+' · '+Math.round(planned/budget*100)+'% 배정':'월 투자예산을 먼저 정하면 계획 비중을 계산합니다.';
    const box=$('investmentPlanList');
    if(!plans.length){box.innerHTML='<div class="empty compact">이 달의 투자 계획이 없습니다.</div>';return;}
    box.innerHTML=plans.map(p=>{
      const share=planned?Math.round(Number(p.amount)/planned*100):0;
      const status=p.status==='done'?'완료':'계획';
      return '<button class="invest-row" data-invest-id="'+esc(p.id)+'"><div class="invest-main"><span class="invest-type">'+esc(p.assetType||'기타')+'</span><b>'+esc(p.name)+(p.symbol?' · '+esc(p.symbol):'')+'</b><small>'+esc(p.targetDate)+' · '+status+' · 계획 내 '+share+'%</small></div><strong>'+won(p.amount)+'</strong></button>';
    }).join('');
    box.querySelectorAll('[data-invest-id]').forEach(btn=>btn.addEventListener('click',()=>{
      const p=data.settings.investmentPlans.find(x=>x.id===btn.dataset.investId);if(p)openInvestmentPlan(p);
    }));
  }
  function openInvestmentBudget(){
    $('investmentBudgetAmount').value=(window.BudgetFeatures?.baseInvestmentBudget?.(monthKey(view),data)??Number(data.settings.investmentBudget||0))||'';
    if($('investmentBudgetMonthLabel'))$('investmentBudgetMonthLabel').textContent=monthKey(view)+' 투자예산';
    if($('investmentCarryover'))$('investmentCarryover').checked=Boolean(data.settings.investmentCarryover);
    $('investmentBudgetOverlay').classList.remove('hidden');
  }
  async function saveInvestmentBudget(){
    const v=Number($('investmentBudgetAmount').value);
    if(!Number.isFinite(v)||v<0)return toast('투자예산을 올바르게 입력하세요.');
    if(window.BudgetFeatures?.saveInvestmentBudget)await window.BudgetFeatures.saveInvestmentBudget(v);else{data.settings.investmentBudget=v;data.settingsUpdatedAt=new Date().toISOString();await persist();}$('investmentBudgetOverlay').classList.add('hidden');renderInvestment();toast('월 투자예산을 저장했습니다.');
  }
  async function clearInvestmentBudget(){
    if(window.BudgetFeatures?.saveInvestmentBudget)await window.BudgetFeatures.saveInvestmentBudget(0);else{data.settings.investmentBudget=0;data.settingsUpdatedAt=new Date().toISOString();await persist();}$('investmentBudgetAmount').value='';$('investmentBudgetOverlay').classList.add('hidden');renderInvestment();toast('투자예산을 지웠습니다.');
  }
  function openInvestmentPlan(plan=null){
    $('investmentPlanId').value=plan?.id||'';
    $('investmentPlanTitle').textContent=plan?'투자 계획 수정':'투자 계획 추가';
    $('investmentAssetType').value=plan?.assetType||'ETF';
    $('investmentName').value=plan?.name||'';
    $('investmentSymbol').value=plan?.symbol||'';
    $('investmentAmount').value=plan?.amount??'';
    const d=new Date(view.getFullYear(),view.getMonth(),1,12);
    $('investmentTargetDate').value=plan?.targetDate||ymd(d);
    $('investmentStatus').value=plan?.status||'planned';
    $('investmentMemo').value=plan?.memo||'';
    $('deleteInvestmentPlanBtn').classList.toggle('hidden',!plan);
    $('investmentPlanOverlay').classList.remove('hidden');
  }
  async function saveInvestmentPlan(){
    const name=$('investmentName').value.trim(),amount=Number($('investmentAmount').value),targetDate=$('investmentTargetDate').value;
    if(!name)return toast('종목·자산명을 입력하세요.');
    if(!Number.isFinite(amount)||amount<=0)return toast('계획 금액을 입력하세요.');
    if(!targetDate)return toast('목표일을 선택하세요.');
    const id=$('investmentPlanId').value||crypto.randomUUID(),old=data.settings.investmentPlans.find(p=>p.id===id);
    const item={id,assetType:$('investmentAssetType').value,name,symbol:$('investmentSymbol').value.trim().toUpperCase(),amount,targetDate,status:$('investmentStatus').value,memo:$('investmentMemo').value.trim(),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    const idx=data.settings.investmentPlans.findIndex(p=>p.id===id);if(idx>=0)data.settings.investmentPlans[idx]=item;else data.settings.investmentPlans.push(item);
    data.settingsUpdatedAt=new Date().toISOString();await persist();
    $('investmentPlanOverlay').classList.add('hidden');view=new Date(targetDate+'T12:00:00');view.setDate(1);renderAll();switchTab('investment');toast('투자 계획을 저장했습니다.');
  }
  async function deleteInvestmentPlan(){
    const id=$('investmentPlanId').value;if(!id||!confirm('이 투자 계획을 삭제할까요?'))return;
    window.BudgetFeatures?.markInvestmentPlanDeleted?.(id);data.settings.investmentPlans=data.settings.investmentPlans.filter(p=>p.id!==id);data.settingsUpdatedAt=new Date().toISOString();
    await persist();$('investmentPlanOverlay').classList.add('hidden');renderInvestment();toast('투자 계획을 삭제했습니다.');
  }

  function fillCats(type,selected){const cats=type==='expense'?expenseCats:incomeCats;$('cat').innerHTML=cats.map(c=>`<option ${c===selected?'selected':''}>${esc(c)}</option>`).join('')}
  function rememberedDate(){const d=localStorage.getItem(STORAGE.lastDate);return /^\d{4}-\d{2}-\d{2}$/.test(d||'')?d:ymd(new Date())}
  function subDetailsFor(category,detail=''){return subDetailMap[`${category}|${detail}`]||subDetailMap[category]||[]}
  function updateSubDetailField(selectedSubDetail=''){const isExpense=$('type').value==='expense',category=$('cat').value,detail=$('detail').value||'',items=isExpense?subDetailsFor(category,detail):[];$('subDetailField').classList.toggle('hidden',items.length===0);if(items.length){$('subDetailLabel').textContent=`${category} 2차 세부항목`;$('subDetail').innerHTML='<option value="">선택 안 함</option>'+items.map(d=>`<option ${d===selectedSubDetail?'selected':''}>${esc(d)}</option>`).join('')}else{$('subDetail').innerHTML='';$('subDetail').value=''}}
  function updateExtraFields(selectedDetail='',selectedSubDetail=''){const type=$('type').value,category=$('cat').value,isExpense=type==='expense',isFood=isExpense&&category==='식비';$('mealField').classList.toggle('hidden',!isFood);$('foodContextField').classList.toggle('hidden',!isFood);if(!isFood){$('meal').value='';$('foodContext').value=''}const details=isExpense?(detailMap[category]||[]):[];$('detailField').classList.toggle('hidden',details.length===0);if(details.length){$('detailLabel').textContent=`${category} 세부항목`;$('detail').innerHTML='<option value="">선택하세요</option>'+details.map(d=>`<option ${d===selectedDetail?'selected':''}>${esc(d)}</option>`).join('')}else $('detail').innerHTML='';updateSubDetailField(selectedSubDetail)}
  function recentPatterns(){const seen=new Set(),out=[];for(const t of [...data.transactions].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))){if(t.type!=='expense')continue;const k=[t.category,t.meal,t.foodContext,t.detail,t.subDetail,t.payment].join('|');if(seen.has(k))continue;seen.add(k);out.push(t);if(out.length>=3)break}return out}
  function applyPattern(t){fillCats('expense',t.category);$('cat').value=t.category;$('meal').value=t.meal||'';$('foodContext').value=t.foodContext||'';$('pay').value=t.payment||'카드';updateExtraFields(t.detail||'',t.subDetail||'')}
  function renderQuickSuggestions(){const patterns=recentPatterns(),wrap=$('quickSuggestWrap'),box=$('quickSuggestions');if(!patterns.length){wrap.classList.add('hidden');return}wrap.classList.remove('hidden');box.innerHTML=patterns.map((t,i)=>`<button type="button" data-p="${i}">${esc([t.category,t.meal,t.foodContext,t.detail,t.subDetail].filter(Boolean).join(' · '))}</button>`).join('');box.querySelectorAll('[data-p]').forEach(btn=>btn.addEventListener('click',()=>applyPattern(patterns[Number(btn.dataset.p)])))}
  function openTx(type,tx=null){$('type').value=type;$('id').value=tx?.id||'';$('txTitle').textContent=tx?'내역 수정':(type==='expense'?'지출 기록':'수입 기록');$('date').value=tx?.date||rememberedDate();$('amount').value=tx?.amount??'';$('title').value=tx?.title??'';$('memo').value=tx?.memo??'';$('pay').value=tx?.payment??'카드';fillCats(type,tx?.category);$('meal').value=tx?.meal??'';$('foodContext').value=tx?.foodContext??'';$('payField').classList.toggle('hidden',type==='income');$('delWrap').classList.toggle('hidden',!tx);updateExtraFields(tx?.detail||'',tx?.subDetail||'');renderQuickSuggestions();$('merchantHint').classList.add('hidden');$('txOverlay').classList.remove('hidden');setTimeout(()=>$('amount').focus(),80)}
  function normalizeMerchant(s){return String(s||'').toLowerCase().replace(/\s+/g,' ').trim()}
  function merchantVariants(title){
    const raw=normalizeMerchant(title);
    if(!raw)return[];
    const cleaned=raw
      .replace(/(?:주식회사|유한회사|㈜|\(주\))/g,' ')
      .replace(/(?:네이버\s*페이|카카오\s*페이|toss|토스)\s*[*·:/-]?\s*/gi,' ')
      .replace(/\b(?:승인|결제|체크|신용)\b/g,' ')
      .replace(/\s+/g,' ').trim();
    const compact=cleaned.replace(/[^0-9a-z가-힣]/g,'');
    const noBranch=compact.replace(/(?:본점|지점|점)$|\d{2,}$/g,'');
    return [...new Set([raw,cleaned,compact,noBranch].filter(v=>v&&v.length>=2))];
  }
  function merchantProfileFor(title){
    const exact=normalizeMerchant(title);
    if(!exact)return null;
    if(data.merchantProfiles?.[exact])return{...data.merchantProfiles[exact],match:'exact'};
    const variants=merchantVariants(title),matches=[];
    for(const [key,profile] of Object.entries(data.merchantProfiles||{})){
      const keys=merchantVariants(key);
      let matched=false;
      for(const a of variants)for(const b of keys){
        if(a===b){matched=true;break}
        const short=a.length<=b.length?a:b,long=a.length<=b.length?b:a;
        if(short.length>=4&&long.includes(short)){matched=true;break}
      }
      if(matched)matches.push(profile);
    }
    if(!matches.length)return null;
    const categories=new Set(matches.map(p=>p?.category).filter(Boolean));
    if(categories.size!==1)return null;
    matches.sort((a,b)=>String(b?.updatedAt||'').localeCompare(String(a?.updatedAt||'')));
    return{...matches[0],match:'similar'};
  }
  function classifyMerchant(title,fallback={}){
    const p=merchantProfileFor(title);
    return p?{...fallback,...p,classificationSource:p.match==='exact'?'learned-exact':'learned-similar'}:{...fallback,classificationSource:'rules'};
  }
  function rememberMerchantProfile(item){
    if(!data||item?.type!=='expense')return false;
    const title=String(item.title||'').trim();
    if(!title||title===item.category)return false;
    data.merchantProfiles[normalizeMerchant(title)]={
      category:item.category||'기타',meal:item.meal||'',foodContext:item.foodContext||'',detail:item.detail||'',subDetail:item.subDetail||'',
      payment:item.payment||'카드',updatedAt:item.updatedAt||new Date().toISOString()
    };
    return true;
  }
  function applyMerchantProfile(title){const p=merchantProfileFor(title);if(!p)return false;fillCats('expense',p.category);$('cat').value=p.category;$('meal').value=p.meal||'';$('foodContext').value=p.foodContext||'';$('pay').value=p.payment||$('pay').value;updateExtraFields(p.detail||'',p.subDetail||'');$('merchantHint').textContent=`이전에 '${title}'과 같은 가맹점을 ${[p.category,p.meal,p.foodContext,p.detail,p.subDetail].filter(Boolean).join(' · ')}로 저장했어요. 자동 적용했습니다.`;$('merchantHint').classList.remove('hidden');return true}
  async function saveTx(){const type=$('type').value,amount=Number($('amount').value),date=$('date').value;if(!date)return toast('날짜를 선택하세요.');if(!Number.isFinite(amount)||amount<=0)return toast('금액을 입력하세요.');const category=$('cat').value,isFood=type==='expense'&&category==='식비',details=detailMap[category]||[],subDetails=subDetailsFor(category,$('detail').value||'');if(isFood&&!mealTypes.includes($('meal').value))return toast('식사 구분을 선택하세요.');if(isFood&&!foodContexts.includes($('foodContext').value))return toast('식사 상황을 선택하세요.');if(type==='expense'&&details.length&&!details.includes($('detail').value))return toast(`${category} 세부항목을 선택하세요.`);localStorage.setItem(STORAGE.lastDate,date);const id=$('id').value||crypto.randomUUID(),old=data.transactions.find(t=>t.id===id),title=$('title').value.trim()||category,item={id,type,date,amount,category,meal:isFood?$('meal').value:'',foodContext:isFood?$('foodContext').value:'',detail:type==='expense'&&details.length?$('detail').value:'',subDetail:type==='expense'&&subDetails.includes($('subDetail').value)?$('subDetail').value:'',payment:type==='expense'?$('pay').value:'',title,memo:$('memo').value.trim(),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};const idx=data.transactions.findIndex(t=>t.id===id);if(idx>=0)data.transactions[idx]=item;else data.transactions.push(item);if(type==='expense')rememberMerchantProfile(item);await persist();$('txOverlay').classList.add('hidden');view=new Date(date+'T00:00:00');view.setDate(1);renderAll();toast('저장했습니다.')}
  async function deleteTx(){const id=$('id').value;if(!id||!confirm('이 내역을 삭제할까요?'))return;data.deletedTransactions=data.deletedTransactions||[];data.deletedTransactions.push({id,deletedAt:new Date().toISOString()});data.transactions=data.transactions.filter(t=>t.id!==id);await persist();$('txOverlay').classList.add('hidden');renderAll();toast('삭제했습니다.')}

  function recurringItems(){const map={};data.transactions.filter(t=>t.type==='expense'&&t.title).forEach(t=>{const k=normalizeMerchant(t.title);(map[k]??=[]).push(t)});return Object.values(map).map(items=>({name:items[0].title,count:items.length,total:items.reduce((s,t)=>s+t.amount,0),avg:items.reduce((s,t)=>s+t.amount,0)/items.length,months:new Set(items.map(t=>t.date.slice(0,7))).size})).filter(x=>x.count>=2).sort((a,b)=>b.total-a.total)}
  function renderAnalysis(){
    if(!data)return;const current=currentMonthTransactions(),previous=previousMonthTransactions(),expenses=current.filter(t=>t.type==='expense'),{expense,income}=totals(current),cats=totalsByCategory(current),prevCats=totalsByCategory(previous),sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]),details=Object.entries(detailTotals(current)).sort((a,b)=>b[1]-a[1]);
    if(!expense){$('analysisBody').innerHTML='<div class="empty">분석할 지출 내역이 아직 없습니다.</div>';return}
    const localPayRate=Number(data.settings.localPaybackRate||0),localPaySpend=expenses.filter(t=>t.payment==='지역화폐').reduce((s,t)=>s+t.amount,0),localPayback=localPaySpend*localPayRate/100;
    const foodTx=expenses.filter(t=>t.category==='식비'),foodTotal=cats['식비']||0,mealTotals=Object.fromEntries(mealTypes.map(k=>[k,0])),contextTotals=Object.fromEntries(foodContexts.map(k=>[k,0]));foodTx.forEach(t=>{if(mealTotals[t.meal]!=null)mealTotals[t.meal]+=t.amount;if(contextTotals[t.foodContext]!=null)contextTotals[t.foodContext]+=t.amount});
    const discretionary=['카페','편의점','쇼핑','여가','구독'],optional=discretionary.reduce((s,c)=>s+(cats[c]||0),0),tips=[];
    if(sorted[0])tips.push({title:`가장 큰 지출은 ${sorted[0][0]}`,text:`이번 달 ${won(sorted[0][1])}, 전체 지출의 ${Math.round(sorted[0][1]/expense*100)}%입니다.`});
    const growth=sorted.map(([c,v])=>({c,v,prev:prevCats[c]||0})).filter(x=>x.prev>0&&x.v>x.prev*1.25).sort((a,b)=>(b.v-b.prev)-(a.v-a.prev))[0];if(growth)tips.push({title:`${growth.c} 지출 증가`,text:`지난달보다 ${won(growth.v-growth.prev)} 늘었습니다.`});
    if(optional>0)tips.push({title:'줄이기 쉬운 선택지출',text:`카페·편의점·쇼핑·여가·구독에 ${won(optional)}을 썼어요. 20%만 줄이면 약 ${won(optional*.2)} 절약할 수 있습니다.`});
    const taxi=expenses.filter(t=>t.category==='교통'&&t.detail==='택시').reduce((s,t)=>s+t.amount,0),transport=cats['교통']||0;if(transport&&taxi>=transport*.4)tips.push({title:'택시 비중이 높아요',text:`교통비 ${won(transport)} 중 택시가 ${won(taxi)}입니다.`});
    if(foodTotal){const alcohol=mealTotals['술']||0;if(alcohol>=Math.max(50000,foodTotal*.2))tips.push({title:'술 지출 확인',text:`식비 중 술에 ${won(alcohol)}을 사용했어요.`});const topCtx=Object.entries(contextTotals).sort((a,b)=>b[1]-a[1])[0];if(topCtx&&topCtx[1]>=foodTotal*.45)tips.push({title:`${topCtx[0]} 식비 비중이 큼`,text:`식비 중 ${topCtx[0]}에서 ${won(topCtx[1])}을 사용했습니다.`})}
    const budgetStatuses=(data.settings.budgetRules||[]).map(r=>budgetStatus(r,current)).sort((a,b)=>b.ratio-a.ratio),over=budgetStatuses.filter(s=>s.ratio>=1),near=budgetStatuses.filter(s=>s.ratio>=.8&&s.ratio<1);over.forEach(s=>tips.unshift({title:`${s.label} 예산 초과`,text:`예산 ${won(s.amount)}보다 ${won(Math.abs(s.remaining))} 더 사용했습니다.`}));near.slice(0,2).forEach(s=>tips.unshift({title:`${s.label} 예산 주의`,text:`예산의 ${Math.round(s.ratio*100)}%를 사용했습니다. 남은 금액은 ${won(s.remaining)}입니다.`}));
    const rec=recurringItems().filter(x=>x.months>=2||x.count>=3).slice(0,5),topRows=sorted.slice(0,5).map(([c,v])=>`<button type="button" class="analysis-item category-drill-trigger" data-category-drill="${esc(c)}" aria-label="${esc(c)} 세부 지출 내역 보기"><strong>${esc(c)} · ${Math.round(v/expense*100)}%</strong><span>${won(v)}</span><span class="drill-chevron" aria-hidden="true">›</span></button>`).join(''),detailRows=details.slice(0,7).map(([d,v])=>`<div class="analysis-item"><strong>${esc(d)}</strong>${won(v)}</div>`).join('')||'<div class="analysis-item">세부항목이 쌓이면 여기에 보여드려요.</div>',repeatRows=rec.map(r=>`<div class="analysis-item"><strong>${esc(r.name)} · ${r.count}회</strong>총 ${won(r.total)} · 건당 평균 ${won(r.avg)}</div>`).join('')||'<div class="analysis-item">반복 결제가 더 쌓이면 자동으로 찾아드려요.</div>',budgetRows=budgetStatuses.length?budgetStatuses.map(s=>budgetRowHtml(s)).join(''):'<div class="analysis-item">항목별 예산을 설정하면 사용률과 초과 여부를 함께 분석합니다.</div>',spendRate=income?Math.round(expense/income*100):null;
    $('analysisBody').innerHTML=`<div class="analysis-hero"><div class="kicker">이번 달 총지출</div><div class="big">${won(expense)}</div><div class="sub">${income?`수입의 ${spendRate}% 사용`:'수입 내역 없이 지출 중심 분석'}</div></div><div class="analysis-grid"><div class="analysis-card"><h3>선택지출</h3><div class="value">${won(optional)}</div></div><div class="analysis-card"><h3>절약 여지</h3><div class="value saving">${won(optional*.2)}</div><div class="lab">선택지출 20% 절감 가정</div></div><div class="analysis-card"><h3>지역화폐 사용</h3><div class="value">${won(localPaySpend)}</div></div><div class="analysis-card"><h3>예상 페이백</h3><div class="value saving">${won(localPayback)}</div><div class="lab">설정 비율 ${localPayRate}% 기준</div></div><div class="analysis-card full"><h3>항목별 예산 현황</h3><div class="budget-summary-list">${budgetRows}</div></div><div class="analysis-card full"><h3>지출 비중 TOP</h3><div class="analysis-list">${topRows}</div></div><div class="analysis-card full"><h3>세부항목 TOP</h3><div class="analysis-list">${detailRows}</div></div><div class="analysis-card full"><h3>반복 지출 탐지</h3><div class="analysis-list">${repeatRows}</div></div><div class="analysis-card full"><span class="analysis-badge">자동 판단</span><h3>이번 달 어디서 줄일까?</h3><div class="analysis-list">${tips.map(t=>`<div class="analysis-item"><strong>${esc(t.title)}</strong>${esc(t.text)}</div>`).join('')}</div></div></div>`;
  }

  function detectPayment(text){if(/지역화폐|지역사랑상품권|지역사랑\s*상품권|지역상품권/i.test(text))return '지역화폐';if(/카카오\s*페이|kakao\s*pay/i.test(text))return '카카오페이';if(/네이버\s*페이|naver\s*pay/i.test(text))return '네이버페이';if(/토스|toss/i.test(text))return '토스';return '간편결제'}
  function detectCategory(text){if(/스타벅스|투썸|메가커피|컴포즈|빽다방|이디야|폴바셋|할리스|커피빈|카페|coffee|cafe/i.test(text))return '카페';if(/\bcu\b|gs25|세븐일레븐|7-eleven|이마트24|편의점/i.test(text))return '편의점';if(/택시|카카오t|버스|지하철|ktx|철도|교통|주유|충전/i.test(text))return '교통';if(/병원|약국|의원|치과/i.test(text))return '건강';if(/넷플릭스|유튜브|spotify|구독/i.test(text))return '구독';if(/위스키|whisky|whiskey|전통주|막걸리|주류|리쿼|liquor/i.test(text))return '여가';if(/마트|식당|배달|배민|배달의민족|요기요|쿠팡이츠|치킨|피자|버거|김밥|국밥|식사|밥|고기|회|초밥/i.test(text))return '식비';if(/쇼핑|백화점|쿠팡|무신사|올리브영|스토어/i.test(text))return '쇼핑';return '기타'}
  function detectDetail(category,text){const t=text.toLowerCase();if(category==='교통'){if(/시외|고속버스/.test(t))return '시외버스';if(/시내버스|버스/.test(t))return '시내버스';if(/택시|카카오t/.test(t))return '택시';if(/지하철|metro/.test(t))return '지하철';if(/ktx|srt|철도|기차/.test(t))return 'KTX/기차';if(/주유|충전소/.test(t))return '주유/충전';if(/주차|통행료|하이패스/.test(t))return '주차/통행료'}if(category==='구독'){if(/넷플릭스|유튜브|디즈니|티빙|웨이브/.test(t))return 'OTT';if(/spotify|멜론|음악/.test(t))return '음악';if(/icloud|google one|클라우드|앱/.test(t))return '클라우드/앱'}if(category==='쇼핑'){if(/올리브영|화장품/.test(t))return '화장품';if(/쿠팡|무신사|온라인/.test(t))return '온라인쇼핑'}if(category==='건강'){if(/약국/.test(t))return '약국';if(/치과/.test(t))return '치과';if(/병원|의원/.test(t))return '병원'}if(category==='여가'&&/위스키|whisky|whiskey|전통주|막걸리|주류|리쿼|liquor/.test(t))return '술';return ''}
  function detectSubDetail(category,detail,text){const t=text.toLowerCase();if(category==='여가'&&detail==='술'){if(/위스키|whisky|whiskey/.test(t))return '위스키';if(/전통주|막걸리/.test(t))return '전통주'}if(category==='식비'&&/배달|배민|배달의민족|요기요|쿠팡이츠/.test(t))return '배달';return ''}
  function detectMeal(text){const t=text.toLowerCase();if(/소주|맥주|와인|위스키|하이볼|막걸리|호프|주점|포차|술|beer|wine/.test(t))return '술';if(/아침|조식|breakfast/.test(t))return '아침';if(/점심|런치|lunch/.test(t))return '점심';if(/저녁|석식|디너|dinner/.test(t))return '저녁';const hm=t.match(/(?:\s|t)(\d{1,2}):(\d{2})/);if(hm){const h=Number(hm[1]);if(h>=5&&h<11)return '아침';if(h<16)return '점심';return '저녁'}return ''}
  function parseDate(text){const m=text.match(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/);if(m)return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;const m2=text.match(/(\d{1,2})[.\/-]\s*(\d{1,2})(?!\d)/);if(m2)return `${new Date().getFullYear()}-${pad(Number(m2[1]))}-${pad(Number(m2[2]))}`;return rememberedDate()}
  function validAmount(n){return Number.isFinite(n)&&n>=100&&n<100000000}
  function parseAmount(text){const patterns=[/(?:결제금액|승인금액|이용금액|총액|합계|보낸\s*금액|받은\s*금액)\s*[:：]?\s*[₩￦]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,8})\s*원?/gi,/[₩￦]\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,8})/g,/([0-9]{1,3}(?:,[0-9]{3})+)\s*원/g];for(const re of patterns){for(const m of text.matchAll(re)){const n=Number(m[1].replaceAll(',',''));if(validAmount(n))return n}}const candidates=[];for(const line of text.split(/\r?\n/)){if(/잔액|포인트|적립|할인|승인번호|카드번호|계좌/i.test(line))continue;for(const m of line.matchAll(/(?:^|\s)([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,8})(?:\s*원)?(?:\s|$)/g)){const n=Number(m[1].replaceAll(',',''));if(validAmount(n))candidates.push(n)}}return candidates.length?Math.max(...candidates):0}
  function parseTitle(text){const lines=text.split(/\r?\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean),skip=/결제|승인|금액|합계|원$|카드|일시|날짜|토스|네이버페이|카카오페이|pay|잔액|포인트|할인|적립|완료|영수증|주문번호|승인번호|계좌/i;return lines.find(s=>s.length>=2&&s.length<=35&&!skip.test(s)&&!/^\d[\d\s:.,/-]*$/.test(s))||''}
  async function scanImage(file){if(window.BudgetOCRBatch?.scanImage)return window.BudgetOCRBatch.scanImage(file);if(!file)return;if(!window.Tesseract)return toast('문자 인식 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.',3500);$('scanStatus').classList.remove('hidden');$('scanStatus').textContent='이미지에서 거래내역을 읽는 중...';$('scanBtn').disabled=true;noteActivity();try{const result=await Tesseract.recognize(file,'kor+eng',{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',langPath:'https://tessdata.projectnaptha.com/4.0.0',logger:m=>{noteActivity();if(m.status==='recognizing text')$('scanStatus').textContent=`문자 인식 중 ${Math.round((m.progress||0)*100)}%`}});const text=result?.data?.text||'';if(!text.trim())throw 0;const amount=parseAmount(text),date=parseDate(text),payment=detectPayment(text),category=detectCategory(text),title=parseTitle(text),detail=detectDetail(category,text),subDetail=detectSubDetail(category,detail,text),meal=category==='식비'?detectMeal(text):'',isIncome=/입금|받았|송금받|환불|취소\s*입금/i.test(text)&&!/결제|출금|보낸\s*금액/i.test(text);openTx(isIncome?'income':'expense');$('date').value=date;$('amount').value=amount||'';$('title').value=title;$('memo').value='캡처에서 자동 인식';fillCats(isIncome?'income':'expense',isIncome?'기타':category);if(!isIncome){$('pay').value=payment;$('meal').value=meal;updateExtraFields(detail,subDetail);if(title&&!meal&&!detail&&!subDetail)applyMerchantProfile(title)}$('scanStatus').textContent=amount?`자동 인식 완료: ${won(amount)}`:'문자는 읽었지만 금액은 직접 확인해주세요.';toast('캡처 내용을 입력창에 채웠습니다.',2800)}catch(e){console.error(e);$('scanStatus').textContent='이미지 인식에 실패했습니다. 선명한 결제내역 캡처로 다시 시도해주세요.';toast('캡처 인식에 실패했습니다.',3200)}finally{$('scanBtn').disabled=false;$('scanInput').value='';noteActivity()}}

  async function saveBudget(){const v=Number($('budgetAmount').value);if(!Number.isFinite(v)||v<0)return toast('예산을 올바르게 입력하세요.');data.settings.monthlyBudget=v;data.settingsUpdatedAt=new Date().toISOString();await persist();$('budgetOverlay').classList.add('hidden');renderAll();toast('월 예산을 저장했습니다.')}
  async function clearBudget(){data.settings.monthlyBudget=0;data.settingsUpdatedAt=new Date().toISOString();await persist();$('budgetOverlay').classList.add('hidden');renderAll();toast('월 예산을 지웠습니다.')}
  function openBudget(){const b=Number(data.settings.monthlyBudget||0);$('budgetAmount').value=b||'';$('budgetOverlay').classList.remove('hidden')}

  function openLocalPayback(){const rate=Number(data.settings.localPaybackRate||0);$('localPaybackRate').value=rate||'';$('settingsOverlay').classList.add('hidden');$('localPaybackOverlay').classList.remove('hidden')}
  async function saveLocalPayback(){const rate=Number($('localPaybackRate').value);if(!Number.isFinite(rate)||rate<0||rate>100)return toast('0~100% 사이의 비율을 입력하세요.');data.settings.localPaybackRate=rate;data.settingsUpdatedAt=new Date().toISOString();await persist();$('localPaybackOverlay').classList.add('hidden');$('settingsOverlay').classList.remove('hidden');renderAll();toast(`지역화폐 페이백을 ${rate}%로 설정했습니다.`)}
  async function clearLocalPayback(){data.settings.localPaybackRate=0;data.settingsUpdatedAt=new Date().toISOString();await persist();$('localPaybackRate').value='';$('localPaybackOverlay').classList.add('hidden');$('settingsOverlay').classList.remove('hidden');renderAll();toast('지역화폐 페이백 비율을 지웠습니다.')}

  function download(name,blob){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
  function backup(){download(`가계부_암호화백업_${ymd(new Date()).replaceAll('-','')}.json`,new Blob([JSON.stringify({app:'private-household-budget',version:12,exportedAt:new Date().toISOString(),salt:localStorage.getItem(STORAGE.salt),kdf:currentKdf(),vault:JSON.parse(localStorage.getItem(STORAGE.vault))},null,2)],{type:'application/json'}));toast('암호화 백업을 저장했습니다.')}
  function exportCsv(){const rows=[['구분','날짜','카테고리','세부항목','2차 세부항목','식사구분','식사상황','내용','금액','결제수단','메모']];[...data.transactions].sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.type==='expense'?'지출':'수입',t.date,t.category,t.detail||'',t.subDetail||'',t.meal||'',t.foodContext||'',t.title,t.amount,t.payment||'',t.memo||'']));const q=v=>`"${String(v??'').replaceAll('"','""')}"`;download(`가계부_${ymd(new Date()).replaceAll('-','')}.csv`,new Blob(['\uFEFF'+rows.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));toast('CSV를 저장했습니다. 평문 파일이므로 보관에 주의하세요.',3500)}
  async function restoreFile(file){try{const obj=JSON.parse(await file.text());if(obj.app!=='private-household-budget'||!obj.salt||!obj.vault)throw 0;localStorage.setItem(STORAGE.salt,obj.salt);localStorage.setItem(STORAGE.vault,JSON.stringify(obj.vault));if(obj.kdf?.iterations)localStorage.setItem(STORAGE.kdf,JSON.stringify(obj.kdf));else localStorage.removeItem(STORAGE.kdf);localStorage.removeItem(STORAGE.cloudSession);localStorage.removeItem(STORAGE.cloudRevision);cloudSession=null;key=null;data=null;$('settingsOverlay').classList.add('hidden');showOnly('locked');toast('복원했습니다. 백업 당시 비밀번호를 입력하세요.',3500)}catch{toast('올바른 암호화 백업 파일이 아닙니다.')}}
  async function changePassword(){const current=$('currentPassword').value,next=$('newPassword').value,next2=$('newPassword2').value;if(!passwordIsStrong(next))return toast(passwordHint(),3500);if(next!==next2)return toast('새 비밀번호 두 개가 서로 다릅니다.');try{const salt=localStorage.getItem(STORAGE.salt),vault=JSON.parse(localStorage.getItem(STORAGE.vault)),oldKey=await deriveKey(current,salt,currentKdf().iterations);await decryptObject(vault,oldKey);const newSalt=bytesToB64(crypto.getRandomValues(new Uint8Array(16))),newKey=await deriveKey(next,newSalt,STRONG_ITERATIONS),newVault=await encryptObject(data,newKey);localStorage.setItem(STORAGE.salt,newSalt);localStorage.setItem(STORAGE.kdf,JSON.stringify({version:2,iterations:STRONG_ITERATIONS,hash:'SHA-256'}));localStorage.setItem(STORAGE.vault,JSON.stringify(newVault));key=newKey;if(cloudSession)await saveCloudSessionLocal();scheduleCloudSync(150);$('passwordOverlay').classList.add('hidden');$('currentPassword').value=$('newPassword').value=$('newPassword2').value='';toast('비밀번호를 변경했습니다.')}catch{toast('현재 비밀번호가 올바르지 않습니다.')}}

  document.addEventListener('click',e=>{
    const categoryButton=e.target.closest('[data-category-drill]');
    if(categoryButton&&data)openCategoryDrill(categoryButton.dataset.categoryDrill,categoryButton);
    const txButton=e.target.closest('[data-drill-tx]');
    if(txButton&&data){
      const item=data.transactions.find(t=>t.id===txButton.dataset.drillTx);
      if(item){closeCategoryDrill();openTx(item.type,item)}
    }
  });
  $('categoryDrillClose').addEventListener('click',closeCategoryDrill);
  $('categoryDrillOverlay').addEventListener('click',e=>{if(e.target===$('categoryDrillOverlay'))closeCategoryDrill()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('categoryDrillOverlay').classList.contains('hidden'))closeCategoryDrill()});
  $('setupBtn').addEventListener('click',setup);$('cloudRestoreBtn').addEventListener('click',()=>openCloudOverlay(true));$('replaceFromPhoneBtn').addEventListener('click',()=>{if(confirm('이 컴퓨터의 현재 잠긴 가계부를 휴대폰 클라우드 가계부로 교체할까요? 컴퓨터 전용 기록은 기존 가계부 비밀번호 없이는 복구할 수 없습니다.'))openCloudOverlay(true)});$('unlockBtn').addEventListener('click',unlock);$('upin').addEventListener('keydown',e=>{if(e.key==='Enter')unlock()});$('p2').addEventListener('keydown',e=>{if(e.key==='Enter')setup()});
  $('prev').addEventListener('click',()=>{view.setMonth(view.getMonth()-1);renderAll()});$('next').addEventListener('click',()=>{view.setMonth(view.getMonth()+1);renderAll()});
  document.querySelectorAll('.nav-btn[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));$('navAdd').addEventListener('click',()=>openTx('expense'));$('navSettings').addEventListener('click',()=> $('settingsOverlay').classList.remove('hidden'));$('topSettingsBtn').addEventListener('click',()=> $('settingsOverlay').classList.remove('hidden'));$('seeAllBtn').addEventListener('click',()=>switchTab('history'));$('refreshAnalysisBtn').addEventListener('click',renderAnalysis);
  $('quickExpense').addEventListener('click',()=>openTx('expense'));$('quickIncome').addEventListener('click',()=>openTx('income'));$('scanBtn').addEventListener('click',()=> $('scanInput').click());$('scanInput').addEventListener('change',e=>scanImage(e.target.files[0]));
  $('dateUp').addEventListener('click',()=>shiftDateInput('date',1));$('dateDown').addEventListener('click',()=>shiftDateInput('date',-1));$('cat').addEventListener('change',()=>updateExtraFields());$('detail').addEventListener('change',()=>updateSubDetailField());$('title').addEventListener('blur',()=>{if($('type').value==='expense'&&$('title').value.trim())applyMerchantProfile($('title').value.trim())});$('saveBtn').addEventListener('click',saveTx);$('deleteBtn').addEventListener('click',deleteTx);$('cancelBtn').addEventListener('click',()=> $('txOverlay').classList.add('hidden'));$('cancelX').addEventListener('click',()=> $('txOverlay').classList.add('hidden'));
  $('budgetEditBtn').addEventListener('click',openBudget);$('saveBudgetBtn').addEventListener('click',saveBudget);$('clearBudgetBtn').addEventListener('click',clearBudget);$('closeBudgetX').addEventListener('click',()=> $('budgetOverlay').classList.add('hidden'));
  $('categoryBudgetBtn').addEventListener('click',openCategoryBudget);$('settingsCategoryBudgetBtn').addEventListener('click',()=>{$('settingsOverlay').classList.add('hidden');openCategoryBudget()});$('addCategoryBudgetBtn').addEventListener('click',addBudgetRule);$('closeCategoryBudgetX').addEventListener('click',()=> $('categoryBudgetOverlay').classList.add('hidden'));
  $('investmentBudgetBtn').addEventListener('click',openInvestmentBudget);$('addInvestmentPlanBtn').addEventListener('click',()=>openInvestmentPlan());$('closeInvestmentBudgetX').addEventListener('click',()=>$('investmentBudgetOverlay').classList.add('hidden'));$('saveInvestmentBudgetBtn').addEventListener('click',saveInvestmentBudget);$('clearInvestmentBudgetBtn').addEventListener('click',clearInvestmentBudget);$('closeInvestmentPlanX').addEventListener('click',()=>$('investmentPlanOverlay').classList.add('hidden'));$('cancelInvestmentPlanBtn').addEventListener('click',()=>$('investmentPlanOverlay').classList.add('hidden'));$('saveInvestmentPlanBtn').addEventListener('click',saveInvestmentPlan);$('deleteInvestmentPlanBtn').addEventListener('click',deleteInvestmentPlan);$('investmentDateUp').addEventListener('click',()=>shiftDateInput('investmentTargetDate',1));$('investmentDateDown').addEventListener('click',()=>shiftDateInput('investmentTargetDate',-1));$('localPaybackBtn').addEventListener('click',openLocalPayback);$('saveLocalPaybackBtn').addEventListener('click',saveLocalPayback);$('clearLocalPaybackBtn').addEventListener('click',clearLocalPayback);$('closeLocalPaybackX').addEventListener('click',()=>{$('localPaybackOverlay').classList.add('hidden');$('settingsOverlay').classList.remove('hidden')});
  $('closeSettingsX').addEventListener('click',()=> $('settingsOverlay').classList.add('hidden'));$('cloudSyncBtn').addEventListener('click',()=>{$('settingsOverlay').classList.add('hidden');openCloudOverlay(false)});$('closeCloudX').addEventListener('click',()=>{$('cloudOverlay').classList.add('hidden');if(data)$('settingsOverlay').classList.remove('hidden')});$('cloudLoginBtn').addEventListener('click',cloudLogin);$('cloudRegisterBtn').addEventListener('click',cloudRegister);$('syncNowBtn').addEventListener('click',()=>syncCloudNow('manual'));$('cloudReplaceBtn').addEventListener('click',cloudReplaceCurrent);$('disconnectCloudBtn').addEventListener('click',disconnectCloud);$('lockBtn').addEventListener('click',()=>lockNow('가계부를 잠갔습니다.'));$('backupBtn').addEventListener('click',backup);$('csvBtn').addEventListener('click',exportCsv);$('restoreBtn').addEventListener('click',()=> $('restoreInput').click());$('restoreInput').addEventListener('change',e=>{if(e.target.files[0])restoreFile(e.target.files[0]);e.target.value=''});$('restoreLockBtn').addEventListener('click',()=> $('restoreLockInput').click());$('restoreLockInput').addEventListener('change',e=>{if(e.target.files[0])restoreFile(e.target.files[0]);e.target.value=''});$('changePasswordBtn').addEventListener('click',()=>{$('settingsOverlay').classList.add('hidden');$('passwordOverlay').classList.remove('hidden')});$('cancelPasswordBtn').addEventListener('click',()=>{$('passwordOverlay').classList.add('hidden');$('settingsOverlay').classList.remove('hidden')});$('savePasswordBtn').addEventListener('click',changePassword);
  ['pointerdown','pointermove','keydown','touchstart','touchmove','wheel','input','change','scroll'].forEach(ev=>document.addEventListener(ev,noteActivity,{passive:true,capture:true}));document.addEventListener('visibilitychange',()=>{if(!document.hidden&&data&&Date.now()-lastActivity>=IDLE_LOCK_MS)lockNow('3분간 사용하지 않아 자동으로 잠겼습니다.')});setInterval(()=>{if(data&&Date.now()-lastActivity>=IDLE_LOCK_MS)lockNow('3분간 사용하지 않아 자동으로 잠겼습니다.')},15000);
  window.BudgetOCRBatch?.init?.({getData:()=>data,persist,renderAll,toast,touch:noteActivity,detectCategory,detectDetail,detectPayment,detectMeal,detailMap,rememberedDate,classifyMerchant,rememberMerchantProfile});
  window.BudgetFeatures?.init?.({getData:()=>data,getMonth:()=>monthKey(view),getView:()=>view,persist,renderAll,renderList,openTx,updateExtraFields,showOnly,toast,switchTab});
  if(!window.crypto?.subtle)alert('최신 Safari 또는 Chrome에서 열어주세요.');const exists=localStorage.getItem(STORAGE.salt)&&localStorage.getItem(STORAGE.vault);$('legacyNotice').classList.toggle('hidden',Boolean(localStorage.getItem(STORAGE.kdf)));showOnly(exists?'locked':'setup');if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
})();