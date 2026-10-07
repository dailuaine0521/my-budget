(function budgetFeatures() {
  'use strict';
  let ctx=null;
  let fixedEditId='', assetEditId='';
  const $=id=>document.getElementById(id);
  const enc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const won=n=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(n)||0))+'원';
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const nowIso=()=>new Date().toISOString();
  const month=()=>ctx.getMonth();
  const monthDate=m=>new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1,12);
  const CATS=['식비','카페','편의점','교통','주거/공과금','쇼핑','여가','건강','교육','경조사','구독','기타'];
  const ASSET_TYPES={cash:'현금',deposit:'예금·적금',stock:'주식',etf:'ETF',bond:'채권',fund:'펀드',crypto:'가상자산',housing:'부동산',other:'기타',debt:'부채'};
  const amount=n=>Number(n)||0;

  function shape(d) {
    if(!d)return null;
    if(!d.settings||typeof d.settings!=='object')d.settings={};
    const s=d.settings;
    if(!s.finance||typeof s.finance!=='object')s.finance={};
    for(const name of ['recurringRules','assets','templates','deleted'])if(!Array.isArray(s.finance[name]))s.finance[name]=[];
    if(!s.investmentBudgets||typeof s.investmentBudgets!=='object'||Array.isArray(s.investmentBudgets))s.investmentBudgets={};
    if(amount(s.investmentBudget)>0&&!Object.keys(s.investmentBudgets).length){
      s.investmentBudgets[month()]={amount:amount(s.investmentBudget),updatedAt:nowIso()};
      s.investmentBudget=0;
    }
    return s;
  }
  function markDeleted(type,id) {
    const s=shape(ctx.getData());if(!s||!id)return;
    s.finance.deleted.push({type,id,updatedAt:nowIso()});
  }
  function mergeRecords(a=[],b=[],deletions=[],type='') {
    const entries=new Map();
    for(const item of [...b,...a]){
      if(!item?.id)continue;
      const old=entries.get(item.id);
      if(!old||String(item.updatedAt||item.createdAt||'')>=String(old.updatedAt||old.createdAt||''))entries.set(item.id,item);
    }
    for(const t of deletions.filter(x=>x.type===type)){
      const old=entries.get(t.id);
      if(old&&String(t.updatedAt||'')>=String(old.updatedAt||old.createdAt||''))entries.delete(t.id);
    }
    return [...entries.values()];
  }
  function mergeSettings(a={},b={},base={}) {
    const fa=a.finance||{},fb=b.finance||{};
    const deletedMap=new Map();
    for(const row of [...(fb.deleted||[]),...(fa.deleted||[])]){
      if(!row?.type||!row?.id)continue;
      const id=row.type+':'+row.id,old=deletedMap.get(id);
      if(!old||String(row.updatedAt||'')>String(old.updatedAt||''))deletedMap.set(id,row);
    }
    const deleted=[...deletedMap.values()];
    const finance={
      recurringRules:mergeRecords(fa.recurringRules,fb.recurringRules,deleted,'recurring'),
      assets:mergeRecords(fa.assets,fb.assets,deleted,'asset'),
      templates:mergeRecords(fa.templates,fb.templates,deleted,'template'),
      deleted
    };
    const investmentBudgets={...(b.investmentBudgets||{})};
    for(const [k,v] of Object.entries(a.investmentBudgets||{})){
      if(!investmentBudgets[k]||String(v?.updatedAt||'')>=String(investmentBudgets[k]?.updatedAt||''))investmentBudgets[k]=v;
    }
    return {
      ...base, finance, investmentBudgets,
      investmentPlans:mergeRecords(a.investmentPlans,b.investmentPlans,deleted,'investment')
    };
  }
  function monthlyInvestmentBudget(m,d) {
    const s=shape(d);
    return s ? amount(s.investmentBudgets?.[m]?.amount) : 0;
  }
  function baseInvestmentBudget(m,d){return monthlyInvestmentBudget(m,d);}
  async function saveInvestmentBudget(value){
    const d=ctx.getData(),s=shape(d);if(!s)return;
    s.investmentBudgets[month()]={amount:Number(value)||0,updatedAt:nowIso()};
    d.settingsUpdatedAt=nowIso();await ctx.persist();
  }
  function markInvestmentPlanDeleted(id){markDeleted('investment',id);}

  function recurringToDate(rule,yearMonth){
    const y=Number(yearMonth.slice(0,4)),m=Number(yearMonth.slice(5,7)),last=new Date(y,m,0).getDate();
    return `${y}-${pad(m)}-${pad(Math.min(last,Math.max(1,Number(rule.day)||1)))}`;
  }
  function processRecurring(){
    const d=ctx.getData(),s=shape(d);if(!s||!Array.isArray(d.transactions))return 0;
    const current=monthDate(ymd(new Date()).slice(0,7));
    const tombstones=new Set((d.deletedTransactions||[]).map(x=>x.id));
    const ids=new Set(d.transactions.map(x=>x.id));
    let added=0;
    for(const rule of s.finance.recurringRules){
      if(rule.enabled===false)continue;
      const start=/^\d{4}-\d{2}$/.test(rule.startMonth||'')?monthDate(rule.startMonth):current;
      const begin=new Date(Math.max(start.getTime(),new Date(current.getFullYear()-4,current.getMonth(),1).getTime()));
      for(let i=0;i<49;i++){
        const d0=new Date(begin.getFullYear(),begin.getMonth()+i,1,12);
        if(d0>current)break;
        const ym=ymd(d0).slice(0,7),id='recurring:'+rule.id+':'+ym;
        if(ids.has(id)||tombstones.has(id))continue;
        const date=recurringToDate(rule,ym),stamp=nowIso();
        d.transactions.push({id,type:'expense',date,amount:Number(rule.amount),category:rule.category,
          detail:rule.detail||'',subDetail:rule.subDetail||'',
          meal:rule.category==='식비'?(rule.meal||'저녁'):'',
          foodContext:rule.category==='식비'?(rule.foodContext||'혼밥'):'',
          payment:rule.payment||'카드',title:rule.title,memo:'정기지출 자동 등록',recurringSource:rule.id,
          createdAt:stamp,updatedAt:stamp});
        ids.add(id);added++;
      }
    }
    if(added)ctx.persist().catch(()=>ctx.toast('정기지출 저장에 실패했습니다.'));
    return added;
  }
  function beforeRender(){if(!ctx?.getData())return;shape(ctx.getData());processRecurring();}

  function mount(){
    const home=$('homePanel'),invest=$('investmentPanel'),history=$('historyPanel'),analysis=$('analysisPanel');
    home.insertAdjacentHTML('beforeend',`
      <div class="section-title"><span>자주 쓰는 지출</span><button id="manageTemplatesBtn" class="text-btn">템플릿 관리</button></div>
      <div id="quickTemplateList" class="finance-quick"></div>
      <div class="section-title"><span>고정지출 관리</span><button id="manageFixedBtn" class="text-btn">정기지출 설정</button></div>
      <div id="fixedHomeSummary" class="finance-hint"></div>`);
    history.insertAdjacentHTML('afterbegin',`
      <section class="finance-filter-card">
        <div class="section-title" style="margin:0 0 10px"><span>내역 검색·필터</span><button class="text-btn" id="clearHistoryFilter">초기화</button></div>
        <input id="filterQuery" placeholder="가맹점 · 내용 · 메모 검색" aria-label="검색어">
        <div class="finance-filter-grid">
          <select id="filterPeriod" aria-label="조회 기간"><option value="month">선택한 달</option><option value="all">전체 기간</option></select>
          <select id="filterType" aria-label="거래 유형"><option value="">수입·지출 전체</option><option value="expense">지출</option><option value="income">수입</option></select>
          <select id="filterCategory" aria-label="카테고리"><option value="">모든 카테고리</option></select>
          <select id="filterPayment" aria-label="결제수단"><option value="">모든 결제수단</option><option>카드</option><option>현금</option><option>계좌이체</option><option>토스</option><option>네이버페이</option><option>카카오페이</option><option>간편결제</option><option>지역화폐</option><option>기타</option></select>
          <input id="filterFrom" type="date" aria-label="시작일"><input id="filterTo" type="date" aria-label="종료일">
          <input id="filterMin" type="number" min="0" placeholder="최소 금액" aria-label="최소 금액"><input id="filterMax" type="number" min="0" placeholder="최대 금액" aria-label="최대 금액">
        </div>
        <div id="filterResult" class="finance-note">선택한 달 내역</div>
      </section>`);
    $('filterCategory').innerHTML+=[...new Set([...CATS,'급여','용돈/지원','부수입','환급','투자/이자'])].map(c=>`<option>${enc(c)}</option>`).join('');
    analysis.insertAdjacentHTML('afterbegin',`<section class="finance-report" id="financeReport"></section>`);
    invest.insertAdjacentHTML('beforeend',`
      <div class="section-title"><span>자산 현황</span><button id="manageAssetsBtn" class="text-btn">+ 자산 등록</button></div>
      <div class="finance-hint">현금·예금·주식 등의 현재 평가액을 원화로 직접 입력합니다. 시세 자동 조회는 하지 않습니다.</div>
      <div id="assetsDashboard" class="finance-assets"></div>`);

    // Template capture is deliberately separate from transaction saving.
    $('txOverlay').querySelector('.btns').insertAdjacentHTML('beforebegin',
      `<button id="saveTxTemplateBtn" class="btn light full gap-top">☆ 이 입력 내용을 빠른 템플릿으로 저장</button>`);

    document.body.insertAdjacentHTML('beforeend',`
      <div id="fixedOverlay" class="overlay hidden"><div class="modal">
        <div class="modal-head"><h2>고정지출 자동 등록</h2><button class="close-x" id="fixedClose">×</button></div>
        <div class="finance-note">매월 지정한 날짜에 지출을 한 번씩 자동 생성합니다. 31일은 해당 달의 말일로 처리합니다. 생성된 과거 내역은 규칙을 삭제해도 남습니다.</div>
        <input id="fixedId" type="hidden">
        <div class="field"><label>지출명</label><input id="fixedTitle" maxlength="60" placeholder="예: 통신요금"></div>
        <div class="finance-form2">
          <div class="field"><label>금액(원)</label><input id="fixedAmount" type="number" min="1" inputmode="numeric"></div>
          <div class="field"><label>매월 결제일 (1~31)</label><input id="fixedDay" type="number" min="1" max="31" value="1"></div>
          <div class="field"><label>시작월</label><input id="fixedStartMonth" type="month"></div>
          <div class="field"><label>카테고리</label><select id="fixedCategory"></select></div>
          <div class="field"><label>결제수단</label><select id="fixedPayment"><option>카드</option><option>계좌이체</option><option>현금</option><option>간편결제</option><option>지역화폐</option><option>기타</option></select></div>
          <div class="field"><label>상태</label><select id="fixedEnabled"><option value="yes">자동 등록 켜기</option><option value="no">일시 중지</option></select></div>
          <div class="field"><label>식사 구분 (식비만)</label><select id="fixedMeal"><option>저녁</option><option>점심</option><option>아침</option><option>술</option></select></div>
          <div class="field"><label>식사 상황 (식비만)</label><select id="fixedContext"><option>혼밥</option><option>직장</option><option>데이트</option></select></div>
        </div>
        <div class="btns"><button id="resetFixedForm" class="btn light">새 규칙</button><button id="saveFixedBtn" class="btn dark">규칙 저장</button></div>
        <div class="section-title"><span>등록된 고정지출</span></div><div id="fixedList"></div>
      </div></div>

      <div id="assetOverlay" class="overlay hidden"><div class="modal small-modal">
        <div class="modal-head"><h2>자산·부채 등록</h2><button class="close-x" id="assetClose">×</button></div>
        <input id="assetId" type="hidden">
        <div class="field"><label>유형</label><select id="assetType"></select></div>
        <div class="field"><label>자산 이름</label><input id="assetName" maxlength="60" placeholder="예: 주거래 계좌, SPYM"></div>
        <div class="field"><label>현재 평가액 또는 잔액 (원)</label><input id="assetValue" type="number" min="0" inputmode="numeric"></div>
        <div class="finance-note">투자 예정 금액이 아니라 현재 보유 자산의 가치입니다. 부채는 별도 유형으로 등록하세요.</div>
        <div class="btns"><button id="deleteAssetBtn" class="btn danger">삭제</button><button id="saveAssetBtn" class="btn dark">저장</button></div>
      </div></div>

      <div id="templateOverlay" class="overlay hidden"><div class="modal small-modal">
        <div class="modal-head"><h2>빠른 입력 템플릿</h2><button class="close-x" id="templateClose">×</button></div>
        <div class="finance-note">지출·수입 입력 화면에서 “빠른 템플릿으로 저장”을 누르면 여기 등록됩니다. 클릭하면 입력창만 채워지며 거래가 자동 저장되지는 않습니다.</div>
        <div id="templateManager"></div>
      </div></div>`);
    $('fixedCategory').innerHTML=CATS.map(c=>`<option>${enc(c)}</option>`).join('');
    $('assetType').innerHTML=Object.entries(ASSET_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  }

  function bind(){
    const on=(id,event,handler)=>{if(!$(id))throw Error('Missing UI: '+id);$(id).addEventListener(event,handler);};
    for(const id of ['filterQuery','filterPeriod','filterType','filterCategory','filterPayment','filterFrom','filterTo','filterMin','filterMax']){
      on(id,id==='filterQuery'?'input':'change',renderSearch);
    }
    on('clearHistoryFilter','click',()=>{
      for(const id of ['filterQuery','filterType','filterCategory','filterPayment','filterFrom','filterTo','filterMin','filterMax'])$(id).value='';
      $('filterPeriod').value='month';renderSearch();
    });
    on('manageFixedBtn','click',()=>{resetFixedForm();$('fixedOverlay').classList.remove('hidden');renderFixed();});
    on('fixedClose','click',()=>{$('fixedOverlay').classList.add('hidden');});
    on('resetFixedForm','click',resetFixedForm);
    on('saveFixedBtn','click',saveFixed);
    on('manageAssetsBtn','click',()=>openAsset());
    on('assetClose','click',()=>{$('assetOverlay').classList.add('hidden');});
    on('saveAssetBtn','click',saveAsset);
    on('deleteAssetBtn','click',deleteAsset);
    on('manageTemplatesBtn','click',()=>{$('templateOverlay').classList.remove('hidden');renderTemplates();});
    on('templateClose','click',()=>{$('templateOverlay').classList.add('hidden');});
    on('saveTxTemplateBtn','click',saveTemplate);
  }
  async function save(d){d.settingsUpdatedAt=nowIso();await ctx.persist();ctx.renderAll();}

  function renderSearch(){
    const d=ctx?.getData();if(!d)return;
    const m=month(),all=$('filterPeriod').value==='all',q=$('filterQuery').value.trim().toLowerCase();
    const cat=$('filterCategory').value,pay=$('filterPayment').value,type=$('filterType').value;
    const from=$('filterFrom').value,to=$('filterTo').value,min=$('filterMin').value,max=$('filterMax').value;
    const tx=d.transactions.filter(t=>{
      if(!all&&!String(t.date||'').startsWith(m))return false;
      if(q&&![t.title,t.memo,t.category,t.payment,t.detail,t.subDetail].some(v=>String(v||'').toLowerCase().includes(q)))return false;
      if(type&&t.type!==type)return false;
      if(cat&&t.category!==cat)return false;
      if(pay&&t.payment!==pay)return false;
      if(from&&t.date<from||to&&t.date>to)return false;
      if(min!==''&&amount(t.amount)<Number(min))return false;
      if(max!==''&&amount(t.amount)>Number(max))return false;
      return true;
    }).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.updatedAt||'').localeCompare(a.updatedAt||''));
    ctx.renderList(tx);$('historyCount').textContent=tx.length+'건';
    const spend=tx.filter(t=>t.type==='expense').reduce((sum,t)=>sum+amount(t.amount),0);
    $('filterResult').textContent=`검색 결과 ${tx.length}건 · 지출 ${won(spend)} (${all?'전체 기간':'선택한 달'})`;
  }

  function resetFixedForm(){
    fixedEditId='';$('fixedId').value='';$('fixedTitle').value='';$('fixedAmount').value='';
    $('fixedDay').value=String(new Date().getDate());$('fixedStartMonth').value=month();
    $('fixedCategory').value='주거/공과금';$('fixedPayment').value='카드';$('fixedEnabled').value='yes';
    $('fixedMeal').value='저녁';$('fixedContext').value='혼밥';
  }
  function renderFixed(){
    const s=shape(ctx.getData());if(!s)return;
    const list=$('fixedList');if(!s.finance.recurringRules.length){list.innerHTML='<div class="empty compact">등록된 정기지출이 없습니다.</div>';return;}
    list.innerHTML=s.finance.recurringRules.map(r=>`
      <div class="finance-list-row"><button data-fixed-edit="${enc(r.id)}"><b>${enc(r.title)}</b><small>매월 ${Number(r.day)}일 · ${enc(r.category)} · ${r.enabled===false?'중지':'자동 등록'}</small></button>
      <strong>${won(r.amount)}</strong><button class="finance-delete" data-fixed-delete="${enc(r.id)}" aria-label="삭제">×</button></div>`).join('');
    list.querySelectorAll('[data-fixed-edit]').forEach(b=>b.addEventListener('click',()=>{
      const r=s.finance.recurringRules.find(x=>x.id===b.dataset.fixedEdit);if(!r)return;
      fixedEditId=r.id;$('fixedId').value=r.id;$('fixedTitle').value=r.title;$('fixedAmount').value=r.amount;
      $('fixedDay').value=r.day;$('fixedStartMonth').value=r.startMonth;$('fixedCategory').value=r.category;
      $('fixedPayment').value=r.payment;$('fixedEnabled').value=r.enabled===false?'no':'yes';
      $('fixedMeal').value=r.meal||'저녁';$('fixedContext').value=r.foodContext||'혼밥';
    }));
    list.querySelectorAll('[data-fixed-delete]').forEach(b=>b.addEventListener('click',async()=>{
      if(!confirm('정기지출 규칙을 삭제할까요? 이미 등록된 거래 내역은 보존됩니다.'))return;
      const id=b.dataset.fixedDelete;markDeleted('recurring',id);
      s.finance.recurringRules=s.finance.recurringRules.filter(x=>x.id!==id);
      await save(ctx.getData());renderFixed();
    }));
  }
  async function saveFixed(){
    const d=ctx.getData(),s=shape(d);if(!s)return;
    const title=$('fixedTitle').value.trim(),v=Number($('fixedAmount').value),day=Number($('fixedDay').value),start=$('fixedStartMonth').value;
    if(!title||!Number.isFinite(v)||v<=0||!Number.isInteger(day)||day<1||day>31||!/^\d{4}-\d{2}$/.test(start))return ctx.toast('지출명·금액·결제일·시작월을 확인하세요.');
    const old=s.finance.recurringRules.find(x=>x.id===fixedEditId);
    const item={id:old?.id||crypto.randomUUID(),title,amount:v,day,startMonth:start,category:$('fixedCategory').value,
      payment:$('fixedPayment').value,enabled:$('fixedEnabled').value==='yes',meal:$('fixedMeal').value,
      foodContext:$('fixedContext').value,createdAt:old?.createdAt||nowIso(),updatedAt:nowIso()};
    if(old)Object.assign(old,item);else s.finance.recurringRules.push(item);
    await save(d);resetFixedForm();renderFixed();ctx.toast('정기지출 규칙을 저장했습니다.');
  }
  function renderFixedHome(){
    const s=shape(ctx.getData());if(!s)return;
    const active=s.finance.recurringRules.filter(r=>r.enabled!==false);
    $('fixedHomeSummary').textContent=active.length?`자동 등록 ${active.length}건 · 월 예상 ${won(active.reduce((a,r)=>a+amount(r.amount),0))}`:'매달 반복되는 지출을 등록하면 자동으로 내역에 기록됩니다.';
  }

  function openAsset(a=null){
    assetEditId=a?.id||'';$('assetId').value=assetEditId;$('assetType').value=a?.type||'deposit';
    $('assetName').value=a?.name||'';$('assetValue').value=a?.value??'';
    $('deleteAssetBtn').classList.toggle('hidden',!a);$('assetOverlay').classList.remove('hidden');
  }
  async function saveAsset(){
    const d=ctx.getData(),s=shape(d),name=$('assetName').value.trim(),value=Number($('assetValue').value);
    if(!name||!Number.isFinite(value)||value<0)return ctx.toast('자산 이름과 0원 이상의 금액을 입력하세요.');
    const old=s.finance.assets.find(a=>a.id===assetEditId);
    const item={id:old?.id||crypto.randomUUID(),name,type:$('assetType').value,value,createdAt:old?.createdAt||nowIso(),updatedAt:nowIso()};
    if(old)Object.assign(old,item);else s.finance.assets.push(item);
    await save(d);$('assetOverlay').classList.add('hidden');ctx.toast('자산 현황에 반영했습니다.');
  }
  async function deleteAsset(){
    const d=ctx.getData(),s=shape(d),id=assetEditId;if(!id||!confirm('이 자산 기록을 삭제할까요?'))return;
    markDeleted('asset',id);s.finance.assets=s.finance.assets.filter(a=>a.id!==id);
    await save(d);$('assetOverlay').classList.add('hidden');ctx.toast('자산 기록을 삭제했습니다.');
  }
  function renderAssets(){
    const s=shape(ctx.getData());if(!s)return;
    const arr=s.finance.assets,total=arr.filter(a=>a.type!=='debt').reduce((v,a)=>v+amount(a.value),0),
      debts=arr.filter(a=>a.type==='debt').reduce((v,a)=>v+amount(a.value),0),net=total-debts;
    const cards=`<div class="finance-metrics"><div><small>총자산</small><b>${won(total)}</b></div><div><small>부채</small><b>${won(debts)}</b></div><div><small>순자산</small><b>${won(net)}</b></div></div>`;
    const list=arr.length?arr.map(a=>`<button class="finance-asset-row" data-asset="${enc(a.id)}"><div><b>${enc(a.name)}</b><small>${enc(ASSET_TYPES[a.type]||'기타')} · 직접 입력</small></div><strong>${a.type==='debt'?'-':''}${won(a.value)}</strong></button>`).join(''):'<div class="empty compact">등록된 자산이 없습니다.</div>';
    const byType={};for(const a of arr){if(a.type==='debt')continue;byType[a.type]=(byType[a.type]||0)+amount(a.value);}
    const bars=total>0?Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="finance-bar-line"><span>${enc(ASSET_TYPES[k]||'기타')} · ${Math.round(v/total*100)}%</span><div><i style="width:${Math.max(1,v/total*100)}%"></i></div></div>`).join(''):'';
    $('assetsDashboard').innerHTML=cards+`<div class="finance-asset-bars">${bars}</div>`+list;
    $('assetsDashboard').querySelectorAll('[data-asset]').forEach(b=>b.addEventListener('click',()=>{
      const a=s.finance.assets.find(x=>x.id===b.dataset.asset);if(a)openAsset(a);
    }));
  }

  async function saveTemplate(){
    const d=ctx.getData(),s=shape(d);if(!s)return;
    const title=$('title').value.trim()||$('cat').value,v=Number($('amount').value);
    if(!title||!Number.isFinite(v)||v<=0)return ctx.toast('금액과 내용을 입력한 후 템플릿으로 저장하세요.');
    const type=$('type').value,category=$('cat').value;
    const old=s.finance.templates.find(t=>t.type===type&&t.title===title);
    const template={id:old?.id||crypto.randomUUID(),type,category,title,name:title,amount:v,payment:$('pay').value,
      meal:$('meal').value,foodContext:$('foodContext').value,detail:$('detail').value,subDetail:$('subDetail').value,
      createdAt:old?.createdAt||nowIso(),updatedAt:nowIso()};
    if(old)Object.assign(old,template);else s.finance.templates.push(template);
    await save(d);ctx.toast('빠른 입력 템플릿으로 저장했습니다.');
  }
  function useTemplate(t){
    $('templateOverlay').classList.add('hidden');
    ctx.openTx(t.type);
    $('cat').value=t.category;
    $('meal').value=t.meal||'';$('foodContext').value=t.foodContext||'';
    ctx.updateExtraFields(t.detail||'',t.subDetail||'');
    $('pay').value=t.payment||'카드';$('title').value=t.title;$('amount').value=t.amount;
  }
  function renderTemplates(){
    const s=shape(ctx.getData());if(!s)return;
    const arr=s.finance.templates,box=$('templateManager');
    if(!arr.length){box.innerHTML='<div class="empty compact">아직 저장한 템플릿이 없습니다.</div>';return;}
    box.innerHTML=arr.map(t=>`<div class="finance-list-row"><button data-template-use="${enc(t.id)}"><b>${enc(t.name)}</b><small>${enc(t.category)} · ${enc(t.type==='income'?'수입':'지출')}</small></button><strong>${won(t.amount)}</strong><button class="finance-delete" data-template-delete="${enc(t.id)}" aria-label="삭제">×</button></div>`).join('');
    box.querySelectorAll('[data-template-use]').forEach(btn=>btn.addEventListener('click',()=>{
      const t=arr.find(x=>x.id===btn.dataset.templateUse);if(t)useTemplate(t);
    }));
    box.querySelectorAll('[data-template-delete]').forEach(btn=>btn.addEventListener('click',async()=>{
      const id=btn.dataset.templateDelete;if(!confirm('템플릿을 삭제할까요?'))return;
      markDeleted('template',id);s.finance.templates=s.finance.templates.filter(t=>t.id!==id);
      await save(ctx.getData());renderTemplates();
    }));
  }
  function renderQuickTemplates(){
    const s=shape(ctx.getData());if(!s)return;
    const arr=[...s.finance.templates].sort((a,b)=>String(b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5);
    const box=$('quickTemplateList');
    box.innerHTML=arr.length?arr.map(t=>`<button data-quick-template="${enc(t.id)}"><b>${enc(t.name)}</b><small>${won(t.amount)}</small></button>`).join(''):'<div class="finance-hint">거래 입력에서 ☆ 템플릿으로 저장하면 여기에 바로가기 버튼이 생깁니다.</div>';
    box.querySelectorAll('[data-quick-template]').forEach(b=>b.addEventListener('click',()=>{
      const t=arr.find(x=>x.id===b.dataset.quickTemplate);if(t)useTemplate(t);
    }));
  }

  function renderReport(){
    const d=ctx.getData(),s=shape(d);if(!s)return;
    const current=d.transactions.filter(t=>(t.date||'').startsWith(month()));
    const prev=ymd(new Date(ctx.getView().getFullYear(),ctx.getView().getMonth()-1,1)).slice(0,7);
    const previous=d.transactions.filter(t=>(t.date||'').startsWith(prev));
    const sum=(arr,type)=>arr.filter(t=>t.type===type).reduce((n,t)=>n+amount(t.amount),0);
    const income=sum(current,'income'),expense=sum(current,'expense'),balance=income-expense,
      prevExpense=sum(previous,'expense'),savingsRate=income>0?Math.round(balance/income*100):null;
    const plans=(s.investmentPlans||[]).filter(p=>String(p.targetDate||'').startsWith(month()));
    const invested=plans.filter(p=>p.status==='done').reduce((n,p)=>n+amount(p.amount),0);
    const budget=monthlyInvestmentBudget(month(),d);
    const recurring=current.filter(t=>!!t.recurringSource).reduce((n,t)=>n+amount(t.amount),0);
    const diff=prevExpense>0?Math.round((expense-prevExpense)/prevExpense*100):null;
    $('financeReport').innerHTML=`
      <div class="section-title"><span>월간 재무 리포트</span><small>${enc(month())}</small></div>
      <div class="finance-metrics">
        <div><small>총수입</small><b>${won(income)}</b></div>
        <div><small>총지출</small><b>${won(expense)}</b></div>
        <div><small>월 잔여금</small><b>${won(balance)}</b></div>
      </div>
      <div class="finance-report-stats">
        <div>수입 대비 잔여율 <strong>${savingsRate===null?'수입 기록 없음':savingsRate+'%'}</strong></div>
        <div>전월 지출 대비 <strong>${diff===null?'비교 데이터 부족':(diff>0?'+':'')+diff+'%'}</strong></div>
        <div>정기지출 자동 반영 <strong>${won(recurring)}</strong></div>
        <div>투자계획 완료 금액 <strong>${won(invested)}</strong></div>
        <div>해당 월 투자예산 <strong>${budget?won(budget):'미설정'}</strong></div>
      </div>
      <div class="finance-note">잔여금은 수입−지출이며 투자예산·자산 평가액은 별도 관리합니다. 세후 실투자금이나 실제 순저축액과 다를 수 있습니다.</div>`;
  }

  function render(){
    if(!ctx?.getData())return;
    renderSearch();renderFixedHome();renderQuickTemplates();renderAssets();renderReport();
  }
  function init(api){
    ctx=api;mount();bind();
  }
  window.BudgetFeatures={
    init,beforeRender,render,mergeSettings,monthlyInvestmentBudget,baseInvestmentBudget,saveInvestmentBudget,markInvestmentPlanDeleted
  };
})();