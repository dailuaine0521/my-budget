(function budgetFeatures() {
  'use strict';
  let ctx=null;
  let fixedEditId='', assetEditId='', scheduledEditId='';
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
    for(const name of ['recurringRules','assets','templates','scheduledExpenses','deleted'])if(!Array.isArray(s.finance[name]))s.finance[name]=[];
    if(!s.investmentBudgets||typeof s.investmentBudgets!=='object'||Array.isArray(s.investmentBudgets))s.investmentBudgets={};
    if(!s.weeklyBudgetDefault||typeof s.weeklyBudgetDefault!=='object')s.weeklyBudgetDefault={amount:0,updatedAt:''};
    if(!s.weeklyBudgetOverrides||typeof s.weeklyBudgetOverrides!=='object'||Array.isArray(s.weeklyBudgetOverrides))s.weeklyBudgetOverrides={};
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
      scheduledExpenses:mergeRecords(fa.scheduledExpenses,fb.scheduledExpenses,deleted,'scheduled'),
      deleted
    };
    const investmentBudgets={...(b.investmentBudgets||{})};
    for(const [k,v] of Object.entries(a.investmentBudgets||{})){
      if(!investmentBudgets[k]||String(v?.updatedAt||'')>=String(investmentBudgets[k]?.updatedAt||''))investmentBudgets[k]=v;
    }
    const weeklyBudgetDefault=String(a.weeklyBudgetDefault?.updatedAt||'')>=String(b.weeklyBudgetDefault?.updatedAt||'')
      ?(a.weeklyBudgetDefault||b.weeklyBudgetDefault||{amount:0,updatedAt:''})
      :(b.weeklyBudgetDefault||a.weeklyBudgetDefault||{amount:0,updatedAt:''});
    const weeklyBudgetOverrides={...(b.weeklyBudgetOverrides||{})};
    for(const [key,value] of Object.entries(a.weeklyBudgetOverrides||{})){
      if(!weeklyBudgetOverrides[key]||String(value?.updatedAt||'')>=String(weeklyBudgetOverrides[key]?.updatedAt||''))weeklyBudgetOverrides[key]=value;
    }
    return {
      ...base, finance, investmentBudgets, weeklyBudgetDefault, weeklyBudgetOverrides,
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


  // A weekly budget always means Monday through Sunday, including weeks that cross month/year boundaries.
  let selectedWeekKey=null;
  let selectedWeekViewMonth='';
  function weekStartKey(value){
    const date=(value instanceof Date)?new Date(value.getFullYear(),value.getMonth(),value.getDate(),12):
      new Date(Number(String(value).slice(0,4)),Number(String(value).slice(5,7))-1,Number(String(value).slice(8,10)),12);
    if(!Number.isFinite(date.getTime()))return weekStartKey(new Date());
    const dow=(date.getDay()+6)%7;
    date.setDate(date.getDate()-dow);
    return ymd(date);
  }
  function weekEndKey(startKey){
    const d=new Date(Number(startKey.slice(0,4)),Number(startKey.slice(5,7))-1,Number(startKey.slice(8,10))+6,12);
    return ymd(d);
  }
  function weekEffectiveLimit(settings,key){
    const week=settings?.weeklyBudgetOverrides?.[key];
    if(week&&week.amount!==null&&week.amount!==undefined&&Number.isFinite(Number(week.amount)))return Math.max(0,Number(week.amount));
    return Math.max(0,Number(settings?.weeklyBudgetDefault?.amount)||0);
  }
  function currentWeekKey(){
    const v=ctx.getView(),currentYM=ymd(v).slice(0,7),today=new Date();
    if(selectedWeekViewMonth!==currentYM||!selectedWeekKey){
      const selectedDate=(today.getFullYear()===v.getFullYear()&&today.getMonth()===v.getMonth())?
        today:new Date(v.getFullYear(),v.getMonth(),1,12);
      selectedWeekKey=weekStartKey(selectedDate);
      selectedWeekViewMonth=currentYM;
    }
    return selectedWeekKey;
  }

  // No selection means "all spending". Specific selections are inclusive OR,
  // so selecting both transport and taxi never counts a taxi purchase twice.
  function weekEffectiveFilters(settings,key){
    const special=settings?.weeklyBudgetOverrides?.[key];
    const selected=special&&Number(special.amount)>0&&Array.isArray(special.filters)
      ?special.filters:settings?.weeklyBudgetDefault?.filters;
    return Array.isArray(selected)?selected.filter(x=>typeof x==='string'):[];
  }
  function matchesWeeklyFilter(tx,filters){
    if(!Array.isArray(filters)||!filters.length)return true;
    return filters.some(filter=>{
      const [kind,cat,detail]=String(filter).split('|');
      if(kind==='category')return tx.category===cat;
      if(kind==='detail')return tx.category===cat&&tx.detail===detail;
      if(kind==='meal')return tx.category==='식비'&&tx.meal===cat;
      if(kind==='context')return tx.category==='식비'&&tx.foodContext===cat;
      if(kind==='subDetail')return tx.category===cat&&tx.subDetail===detail;
      return false;
    });
  }
  function weeklySelectorCatalog(d){
    const base={
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
    const map=new Map(CATS.map(cat=>[cat,new Set(base[cat]||[])]));
    for(const t of d?.transactions||[]){
      if(t.type!=='expense'||!t.category)continue;
      if(!map.has(t.category))map.set(t.category,new Set());
      if(t.detail)map.get(t.category).add(t.detail);
    }
    const catalog=[...map].map(([category,details])=>({
      category,details:[...details].sort((a,b)=>a.localeCompare(b,'ko'))
    }));
    return catalog;
  }
  function selectedWeeklyFilterLabels(filters){
    return filters.map(v=>{
      const [kind,cat,detail]=v.split('|');
      if(kind==='category')return cat;
      if(kind==='detail')return cat+' · '+detail;
      if(kind==='meal')return '식비 · '+cat;
      if(kind==='context')return '식비 · '+cat+' 상황';
      if(kind==='subDetail')return cat+' · '+detail;
      return v;
    });
  }
  function renderWeeklyFilterChoices(filters=[]){
    const selected=new Set(filters),catalog=weeklySelectorCatalog(ctx.getData());
    const groups=catalog.map(({category,details})=>{
      const categoryKey='category|'+category;
      const child=[
        ...details.map(detail=>({value:'detail|'+category+'|'+detail,label:detail})),
        ...(category==='식비'
          ?['아침','점심','저녁','술'].map(v=>({value:'meal|'+v,label:'식사 · '+v}))
            .concat(['직장','데이트','혼밥'].map(v=>({value:'context|'+v,label:'상황 · '+v})))
          :[])
      ];
      const checked=selected.has(categoryKey)||child.some(x=>selected.has(x.value));
      return `<div class="weekly-filter-group">
        <label class="weekly-filter-cat"><input type="checkbox" class="weekly-filter-item" value="${enc(categoryKey)}" ${selected.has(categoryKey)?'checked':''}><span>${enc(category)} 전체</span></label>
        ${child.length?`<details class="weekly-filter-details" ${checked&&!selected.has(categoryKey)?'open':''}>
          <summary>세부항목 (${child.length}개)</summary>
          <div class="weekly-filter-children">${child.map(opt=>
            `<label><input type="checkbox" class="weekly-filter-item" value="${enc(opt.value)}" ${selected.has(opt.value)?'checked':''}><span>${enc(opt.label)}</span></label>`
          ).join('')}</div>
        </details>`:''}
      </div>`;
    }).join('');
    $('weeklyBudgetCategoryChoices').innerHTML=groups;
    const filtered=Array.isArray(filters)&&filters.length>0;
    $('weeklyFilterAll').checked=!filtered;
    $('weeklyFilterSelected').checked=filtered;
    $('weeklyBudgetCategoryChoices').classList.toggle('weekly-filter-inactive',!filtered);
    $('weeklyBudgetCategoryChoices').querySelectorAll('.weekly-filter-item').forEach(input=>
      input.addEventListener('change',()=>{
        $('weeklyFilterSelected').checked=true;
        $('weeklyBudgetCategoryChoices').classList.remove('weekly-filter-inactive');
      })
    );
  }
  function weeklyFilterInputValues(){
    return [...$('weeklyBudgetCategoryChoices').querySelectorAll('.weekly-filter-item:checked')]
      .map(el=>el.value);
  }

  function weeklyBudgetMetrics(d,key){
    const end=weekEndKey(key),s=shape(d);
    const filters=weekEffectiveFilters(s,key);
    const spent=(d.transactions||[]).filter(t=>t.type==='expense'&&String(t.date||'')>=key&&String(t.date||'')<=end&&matchesWeeklyFilter(t,filters))
      .reduce((total,t)=>total+(Number(t.amount)||0),0);
    const limit=weekEffectiveLimit(s,key);
    return{start:key,end,spent,limit,filters,remaining:limit-spent,ratio:limit?spent/limit:0,percent:limit?Math.round(spent/limit*100):0};
  }
  function weekLabel(key){
    const end=weekEndKey(key),today=ymd(new Date()),current=weekStartKey(today)===key;
    const compact=x=>Number(x.slice(5,7))+'/'+Number(x.slice(8,10));
    return{title:current?'이번 주 소비 목표':'선택한 주 소비 목표',period:compact(key)+' ~ '+compact(end)+' (월~일)'};
  }
  function renderWeeklyBudget(){
    const d=ctx?.getData();if(!d)return;
    const k=currentWeekKey(),p=weeklyBudgetMetrics(d,k),period=weekLabel(k);
    $('weeklyBudgetHeading').textContent=period.title;
    $('weeklyBudgetPeriod').textContent=period.period;
    $('weeklyBudgetLimit').textContent=p.limit>0?won(p.limit):'주간 목표를 설정해보세요';
    $('weeklyBudgetSpent').textContent=won(p.spent);
    const names=selectedWeeklyFilterLabels(p.filters);
    $('weeklyBudgetFiltersLabel').textContent=names.length
      ?'집계 항목: '+names.slice(0,3).join(' · ')+(names.length>3?' 외 '+(names.length-3)+'개':'')
      :'집계 항목: 전체 지출';
    const bar=$('weeklyBudgetMeter');
    bar.max=100;bar.value=p.limit?Math.min(100,Math.max(0,p.ratio*100)):0;
    bar.setAttribute('aria-valuenow',String(p.limit?p.percent:0));
    $('weeklyBudgetPercent').textContent=p.limit?p.percent+'% 사용':'미설정';
    $('weeklyBudgetPercent').classList.toggle('weekly-bad',p.limit>0&&p.ratio>=1);
    $('weeklyBudgetCard').classList.toggle('weekly-over',p.limit>0&&p.ratio>=1);
    if(!p.limit){
      $('weeklyBudgetBalance').textContent='일주일 지출 한도를 정하고 소비 속도를 관리해보세요.';
    }else if(p.remaining<0){
      $('weeklyBudgetBalance').textContent=won(-p.remaining)+' 초과 · 다음 주에는 다시 새 목표로 시작해요.';
    }else{
      const today=ymd(new Date());
      const remainingDays=today<k?7:today>p.end?0:Math.round((Date.UTC(Number(p.end.slice(0,4)),Number(p.end.slice(5,7))-1,Number(p.end.slice(8,10))) - Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-1,Number(today.slice(8,10))))/86400000)+1;
      $('weeklyBudgetBalance').textContent=
        won(p.remaining)+' 남음'+(remainingDays?' · 남은 '+remainingDays+'일 하루 약 '+won(p.remaining/remainingDays):'');
    }
  }
  function shiftWeeklyBudgetWeek(days){
    const old=currentWeekKey(),d=new Date(Number(old.slice(0,4)),Number(old.slice(5,7))-1,Number(old.slice(8,10))+days,12);
    selectedWeekKey=weekStartKey(d);
    renderWeeklyBudget();
  }
  function syncWeeklyAmountInput(){
    const d=ctx.getData(),s=shape(d),week=currentWeekKey(),scope=$('weeklyBudgetScope').value;
    const inherited=Number(s.weeklyBudgetDefault?.amount)||0;
    const custom=s.weeklyBudgetOverrides[week]?.amount;
    $('weeklyBudgetAmount').value=(scope==='week'&&custom!=null?Number(custom):inherited)||'';
    $('weeklyBudgetScopeNote').textContent=scope==='default'
      ?'매주 반복되는 기본 목표입니다. 이미 따로 설정한 주의 한도와 항목은 유지됩니다.'
      :'현재 표시된 한 주에만 적용하며, 다른 주의 목표나 포함 항목은 바꾸지 않습니다.';
    const chosen=scope==='week'&&s.weeklyBudgetOverrides[week]?.amount!=null
      ?s.weeklyBudgetOverrides[week]:s.weeklyBudgetDefault;
    const filters=Array.isArray(chosen?.filters)?chosen.filters
      :(Array.isArray(s.weeklyBudgetDefault?.filters)?s.weeklyBudgetDefault.filters:[]);
    renderWeeklyFilterChoices(filters);
  }
  function openWeeklyBudgetEditor(){
    const s=shape(ctx.getData()),week=currentWeekKey();
    $('weeklyBudgetEditorWeek').textContent=week+' ~ '+weekEndKey(week);
    $('weeklyBudgetScope').value=s.weeklyBudgetOverrides[week]?.amount!=null?'week':'default';
    syncWeeklyAmountInput();
    $('weeklyBudgetOverlay').classList.remove('hidden');
    $('weeklyBudgetAmount').focus();
  }
  async function setWeeklyBudget(erase=false){
    const d=ctx.getData(),s=shape(d),scope=$('weeklyBudgetScope').value,week=currentWeekKey();
    const raw=$('weeklyBudgetAmount').value.trim(),value=Number(raw);
    if(!erase&&(!raw||!Number.isSafeInteger(value)||value<=0||value>1000000000)){
      ctx.toast('주간 목표는 1원 이상 10억 원 이하로 입력하세요.');return;
    }
    const useAll=$('weeklyFilterAll').checked;
    const filters=useAll?[]:weeklyFilterInputValues();
    if(!erase&&!useAll&&!filters.length){ctx.toast('집계할 카테고리나 세부항목을 하나 이상 선택하세요.');return;}
    const updatedAt=nowIso();
    if(scope==='week')s.weeklyBudgetOverrides[week]={amount:erase?null:value,filters:erase?[]:filters,updatedAt};
    else s.weeklyBudgetDefault={amount:erase?0:value,filters:erase?[]:filters,updatedAt};
    d.settingsUpdatedAt=updatedAt;
    await ctx.persist();
    $('weeklyBudgetOverlay').classList.add('hidden');
    ctx.renderAll();
    ctx.toast(erase?'주간 목표 설정을 해제했습니다.':'주간 예산을 저장했습니다.');
  }


  const SCHEDULED_KINDS=['관리비','전기세','통신비','구독','카드대금','투자','보험','기타'];
  function scheduledOccurrenceDate(item,yearMonth){
    if(!/^\d{4}-\d{2}$/.test(yearMonth)||!/^\d{4}-\d{2}-\d{2}$/.test(item?.dueDate||''))return'';
    if(item.repeat==='monthly'){
      if(yearMonth<item.dueDate.slice(0,7))return'';
      const [y,m]=yearMonth.split('-').map(Number),last=new Date(y,m,0).getDate(),day=Math.min(last,Number(item.dueDate.slice(8,10))||1);
      return yearMonth+'-'+pad(day);
    }
    return item.dueDate.startsWith(yearMonth)?item.dueDate:'';
  }
  function scheduledMonthItems(yearMonth=month()){
    const s=shape(ctx.getData());
    const manual=(s.finance.scheduledExpenses||[]).map(item=>{
      const occurrenceDate=scheduledOccurrenceDate(item,yearMonth);
      return occurrenceDate?{...item,occurrenceDate,source:'scheduled'}:null;
    }).filter(Boolean);
    const investments=(s.investmentPlans||[]).filter(p=>p.status!=='done'&&String(p.targetDate||'').startsWith(yearMonth)).map(p=>({
      id:'investment:'+p.id,title:'투자 · '+(p.name||p.symbol||'투자 계획'),amount:amount(p.amount),occurrenceDate:p.targetDate,kind:'투자',repeat:'none',source:'investment'
    }));
    return [...manual,...investments].sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate)||(a.title||'').localeCompare(b.title||'','ko'));
  }
  function renderScheduledCalendar(){
    const d=ctx.getData(),view=ctx.getView(),ym=month(),items=scheduledMonthItems(ym);
    const today=ymd(new Date()),isCurrentMonth=ym===today.slice(0,7),counted=isCurrentMonth?items.filter(x=>x.occurrenceDate>=today):items;
    const total=counted.reduce((n,x)=>n+amount(x.amount),0);
    $('scheduledSummaryLabel').textContent=isCurrentMonth?'오늘 이후 예정지출':'선택한 달 예정지출';
    $('scheduledMonthTotal').textContent=counted.length?('예정 '+won(total)+' · '+counted.length+'건'):'예정지출 없음';
    const byDay=new Map();
    for(const item of items){
      const day=Number(item.occurrenceDate.slice(8,10));
      if(!byDay.has(day))byDay.set(day,[]);
      byDay.get(day).push(item);
    }
    const y=view.getFullYear(),m=view.getMonth(),first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate();
    let cells='';
    for(let i=0;i<first;i++)cells+='<div class="scheduled-cal-cell blank" aria-hidden="true"></div>';
    for(let day=1;day<=last;day++){
      const rows=byDay.get(day)||[],dayTotal=rows.reduce((n,x)=>n+amount(x.amount),0);
      const labels=rows.slice(0,2).map(x=>'<span>'+enc(x.title)+'</span>').join('');
      cells+=`<button type="button" class="scheduled-cal-cell ${rows.length?'has-items':''}" data-scheduled-day="${day}" aria-label="${day}일 예정지출 ${rows.length}건">
        <b>${day}</b>${rows.length?'<strong>'+won(dayTotal)+'</strong>'+labels:''}
      </button>`;
    }
    $('scheduledCalendar').innerHTML='<div class="scheduled-cal-head">'+['일','월','화','수','목','금','토'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="scheduled-cal-grid">'+cells+'</div>';
    const future=items.filter(x=>x.occurrenceDate>=today||ym!==today.slice(0,7)).slice(0,5);
    $('scheduledUpcomingList').innerHTML=future.length?future.map(x=>`<button type="button" class="scheduled-upcoming-row" data-scheduled-edit="${enc(x.id)}">
      <span><b>${enc(x.title)}</b><small>${enc(x.occurrenceDate)} · ${enc(x.kind||'기타')}${x.repeat==='monthly'?' · 매월':''}</small></span>
      <strong>${won(x.amount)}</strong></button>`).join(''):'<div class="finance-hint">이 달에 등록된 예정지출이 없습니다.</div>';
    $('scheduledCalendar').querySelectorAll('[data-scheduled-day]').forEach(btn=>btn.addEventListener('click',()=>{
      const day=Number(btn.dataset.scheduledDay),rows=byDay.get(day)||[];
      if(rows.length===1){if(rows[0].source==='investment')ctx.switchTab('investment');else openScheduledEditor(rows[0]);}
      else if(rows.length>1){
        $('scheduledManageOverlay').classList.remove('hidden');
        renderScheduledManager(day);
      }
    }));
    $('scheduledUpcomingList').querySelectorAll('[data-scheduled-edit]').forEach(btn=>btn.addEventListener('click',()=>{
      const id=btn.dataset.scheduledEdit;
      if(id.startsWith('investment:')){ctx.switchTab('investment');return;}
      const item=shape(d).finance.scheduledExpenses.find(x=>x.id===id);if(item)openScheduledEditor(item);
    }));
  }
  function resetScheduledForm(){
    scheduledEditId='';$('scheduledId').value='';$('scheduledTitle').value='';$('scheduledAmount').value='';
    const v=ctx.getView(),today=new Date(),same=today.getFullYear()===v.getFullYear()&&today.getMonth()===v.getMonth();
    $('scheduledDate').value=ymd(same?today:new Date(v.getFullYear(),v.getMonth(),1,12));
    $('scheduledKind').value='관리비';$('scheduledRepeat').value='none';$('scheduledMemo').value='';
    $('deleteScheduledBtn').classList.add('hidden');
  }
  function openScheduledEditor(item=null){
    if(!item)resetScheduledForm();
    else{
      scheduledEditId=item.id;$('scheduledId').value=item.id;$('scheduledTitle').value=item.title||'';$('scheduledAmount').value=item.amount||'';
      $('scheduledDate').value=item.dueDate||ymd(new Date());$('scheduledKind').value=item.kind||'기타';
      $('scheduledRepeat').value=item.repeat==='monthly'?'monthly':'none';$('scheduledMemo').value=item.memo||'';
      $('deleteScheduledBtn').classList.remove('hidden');
    }
    $('scheduledManageOverlay').classList.remove('hidden');renderScheduledManager();
    setTimeout(()=>$('scheduledTitle').focus(),0);
  }
  function renderScheduledManager(dayFilter=null){
    const s=shape(ctx.getData()),ym=month();
    let items=scheduledMonthItems(ym).filter(x=>x.source==='scheduled');
    if(dayFilter)items=items.filter(x=>Number(x.occurrenceDate.slice(8,10))===Number(dayFilter));
    $('scheduledManagerList').innerHTML=items.length?items.map(x=>`<button type="button" class="scheduled-manage-row" data-scheduled-manager="${enc(x.id)}">
      <span><b>${enc(x.title)}</b><small>${enc(x.occurrenceDate)} · ${enc(x.kind||'기타')}${x.repeat==='monthly'?' · 매월 반복':''}</small></span><strong>${won(x.amount)}</strong></button>`).join('')
      :'<div class="finance-hint">등록된 예정지출이 없습니다.</div>';
    $('scheduledManagerList').querySelectorAll('[data-scheduled-manager]').forEach(btn=>btn.addEventListener('click',()=>{
      const item=s.finance.scheduledExpenses.find(x=>x.id===btn.dataset.scheduledManager);if(item)openScheduledEditor(item);
    }));
  }
  async function saveScheduled(){
    const d=ctx.getData(),s=shape(d),title=$('scheduledTitle').value.trim(),value=Number($('scheduledAmount').value),dueDate=$('scheduledDate').value;
    if(!title)return ctx.toast('예정지출 이름을 입력하세요.');
    if(!Number.isSafeInteger(value)||value<=0||value>1000000000)return ctx.toast('예정 금액을 올바르게 입력하세요.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))return ctx.toast('예정일을 선택하세요.');
    const old=s.finance.scheduledExpenses.find(x=>x.id===scheduledEditId),stamp=nowIso();
    const item={id:old?.id||crypto.randomUUID(),title,amount:value,dueDate,kind:$('scheduledKind').value||'기타',
      repeat:$('scheduledRepeat').value==='monthly'?'monthly':'none',memo:$('scheduledMemo').value.trim(),
      createdAt:old?.createdAt||stamp,updatedAt:stamp};
    if(old)Object.assign(old,item);else s.finance.scheduledExpenses.push(item);
    d.settingsUpdatedAt=stamp;await ctx.persist();$('scheduledManageOverlay').classList.add('hidden');ctx.renderAll();ctx.toast('예정지출을 저장했습니다.');
  }
  async function deleteScheduled(){
    if(!scheduledEditId||!confirm('이 예정지출을 삭제할까요? 매월 반복 항목이면 앞으로의 일정도 함께 사라집니다.'))return;
    const d=ctx.getData(),s=shape(d),id=scheduledEditId;
    markDeleted('scheduled',id);s.finance.scheduledExpenses=s.finance.scheduledExpenses.filter(x=>x.id!==id);
    d.settingsUpdatedAt=nowIso();await ctx.persist();$('scheduledManageOverlay').classList.add('hidden');ctx.renderAll();ctx.toast('예정지출을 삭제했습니다.');
  }

  function ruleMatchesForScore(rule,t){
    if(t.type!=='expense')return false;
    if(rule.type==='category')return t.category===rule.category;
    if(rule.type==='detail')return t.category===rule.category&&t.detail===rule.detail;
    if(rule.type==='subDetail')return t.category===rule.category&&(!rule.detail||t.detail===rule.detail)&&t.subDetail===rule.subDetail;
    if(rule.type==='meal')return t.category==='식비'&&t.meal===rule.meal;
    if(rule.type==='foodContext')return t.category==='식비'&&t.foodContext===rule.foodContext;
    return false;
  }
  function clamp100(v){return Math.max(0,Math.min(100,Number(v)||0))}
  function monthlyFinanceScore(d,s,current,previous){
    const v=ctx.getView(),now=new Date(),isCurrent=v.getFullYear()===now.getFullYear()&&v.getMonth()===now.getMonth();
    const days=new Date(v.getFullYear(),v.getMonth()+1,0).getDate(),elapsed=isCurrent?now.getDate():days,projectionFactor=isCurrent?days/Math.max(1,elapsed):1;
    const expense=current.filter(t=>t.type==='expense').reduce((n,t)=>n+amount(t.amount),0),income=current.filter(t=>t.type==='income').reduce((n,t)=>n+amount(t.amount),0);
    const parts=[];
    const monthlyBudget=amount(s.monthlyBudget);
    if(monthlyBudget>0){
      const forecast=expense*projectionFactor,ratio=forecast/monthlyBudget,pct=ratio<=1?100:clamp100(100-(ratio-1)*120);
      parts.push({key:'월 예산',weight:35,pct,detail:(isCurrent?'예상 월말 ':'실제 ')+won(forecast)+' / '+won(monthlyBudget)});
    }
    const rules=(s.budgetRules||[]).filter(r=>amount(r.amount)>0);
    if(rules.length){
      const scores=rules.map(r=>{const spent=current.filter(t=>ruleMatchesForScore(r,t)).reduce((n,t)=>n+amount(t.amount),0)*projectionFactor,ratio=spent/amount(r.amount);return ratio<=1?100:clamp100(100-(ratio-1)*150)});
      const pct=scores.reduce((a,b)=>a+b,0)/scores.length;
      parts.push({key:'항목별 예산',weight:25,pct,detail:rules.length+'개 항목 관리'});
    }
    const optionalCats=new Set(['카페','편의점','쇼핑','여가','구독']);
    const optionalNow=current.filter(t=>t.type==='expense'&&optionalCats.has(t.category)).reduce((n,t)=>n+amount(t.amount),0);
    const cutoff=isCurrent?now.getDate():days;
    const optionalPrev=previous.filter(t=>t.type==='expense'&&optionalCats.has(t.category)&&Number(String(t.date||'').slice(-2))<=cutoff).reduce((n,t)=>n+amount(t.amount),0);
    if(optionalPrev>0){
      const change=(optionalNow-optionalPrev)/optionalPrev,pct=change<=0?100:clamp100(100-change*200);
      parts.push({key:'선택지출',weight:20,pct,detail:(change>0?'+':'')+Math.round(change*100)+'% · 전월 같은 기간 대비'});
    }
    if(income>0){
      const savingsRate=(income-expense)/income*100,pct=clamp100(50+savingsRate*1.25);
      parts.push({key:'현금흐름',weight:20,pct,detail:'수입 대비 잔여율 '+Math.round(savingsRate)+'%'});
    }
    if(!parts.length)return{score:null,parts,coverage:0};
    const weight=parts.reduce((n,p)=>n+p.weight,0),score=Math.round(parts.reduce((n,p)=>n+p.pct*p.weight,0)/weight);
    return{score,parts,coverage:parts.length};
  }

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
    $('todayInsight').insertAdjacentHTML('beforebegin',`
      <section id="weeklyBudgetCard" class="weekly-budget-card" aria-labelledby="weeklyBudgetHeading">
        <div class="weekly-budget-title"><div>
          <span class="weekly-kicker">WEEKLY BUDGET</span>
          <h2 id="weeklyBudgetHeading">이번 주 소비 목표</h2>
        </div><button type="button" id="weeklyBudgetEditBtn" class="text-btn">목표 설정</button></div>
        <div class="weekly-budget-nav"><button type="button" id="weeklyBudgetPrev" aria-label="이전 주">‹</button>
          <strong id="weeklyBudgetPeriod"></strong><button type="button" id="weeklyBudgetNext" aria-label="다음 주">›</button></div>
        <div class="weekly-budget-values"><div><small>지금까지 사용</small><strong id="weeklyBudgetSpent">0원</strong></div>
          <div class="weekly-budget-goal"><small>주간 목표</small><b id="weeklyBudgetLimit">미설정</b></div></div>
        <div class="weekly-budget-progress-head"><b id="weeklyBudgetPercent">미설정</b><span>설정한 금액 대비 사용률</span></div>
        <progress id="weeklyBudgetMeter" class="weekly-budget-meter" max="100" value="0" aria-label="주간 소비 목표 사용률"></progress>
        <div id="weeklyBudgetFiltersLabel" class="weekly-budget-filters-label">집계 항목: 전체 지출</div>
        <div class="weekly-budget-remaining" id="weeklyBudgetBalance">이번 주 목표를 설정해보세요.</div>
      </section>`);
    home.insertAdjacentHTML('beforeend',`
      <div class="section-title"><span>예정지출 캘린더</span><button id="manageScheduledBtn" class="text-btn">관리</button></div>
      <section class="scheduled-card">
        <div class="scheduled-summary"><span id="scheduledSummaryLabel">오늘 이후 예정지출</span><b id="scheduledMonthTotal">예정지출 없음</b></div>
        <div id="scheduledCalendar" class="scheduled-calendar"></div>
        <div id="scheduledUpcomingList" class="scheduled-upcoming-list"></div>
      </section>
      <div class="section-title"><span>자주 쓰는 지출</span><button id="manageTemplatesBtn" class="text-btn">템플릿 관리</button></div>
      <div id="quickTemplateList" class="finance-quick"></div>
      <div class="section-title"><span>고정지출 관리</span><button id="manageFixedBtn" class="text-btn">정기지출 설정</button></div>
      <div id="fixedHomeSummary" class="finance-hint"></div>`);
    history.insertAdjacentHTML('afterbegin',`
      <details class="finance-filter-card finance-filter-collapsible" id="historyFilterDetails">
        <summary class="finance-filter-summary" aria-label="내역 검색·필터 열기 또는 닫기">
          <span class="finance-filter-summary-copy"><b>내역 검색·필터</b><small id="historyFilterSummaryMeta">선택한 달</small></span>
          <span class="finance-filter-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="finance-filter-content">
          <div class="finance-filter-toolbar"><span>원하는 조건으로 내역을 좁혀보세요.</span><button class="text-btn" id="clearHistoryFilter">초기화</button></div>
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
        </div>
      </details>`);
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
      <div id="scheduledManageOverlay" class="overlay hidden"><div class="modal scheduled-modal">
        <div class="modal-head"><div><div class="eyebrow">UPCOMING CASH OUT</div><h2>예정지출 관리</h2></div><button type="button" id="scheduledClose" class="close-x">×</button></div>
        <input id="scheduledId" type="hidden">
        <div class="finance-form2">
          <div class="field"><label for="scheduledTitle">이름</label><input id="scheduledTitle" maxlength="60" placeholder="예: 10월 관리비"></div>
          <div class="field"><label for="scheduledAmount">예상 금액</label><input id="scheduledAmount" type="number" min="1" step="1000" inputmode="numeric"></div>
          <div class="field"><label for="scheduledDate">예정일</label><input id="scheduledDate" type="date"></div>
          <div class="field"><label for="scheduledKind">구분</label><select id="scheduledKind">${SCHEDULED_KINDS.map(x=>'<option>'+x+'</option>').join('')}</select></div>
          <div class="field"><label for="scheduledRepeat">반복</label><select id="scheduledRepeat"><option value="none">한 번만</option><option value="monthly">매월 같은 날짜</option></select></div>
          <div class="field"><label for="scheduledMemo">메모</label><input id="scheduledMemo" maxlength="100" placeholder="선택 사항"></div>
        </div>
        <div class="btns"><button type="button" id="deleteScheduledBtn" class="btn danger hidden">삭제</button><button type="button" id="newScheduledBtn" class="btn light">새 일정</button><button type="button" id="saveScheduledBtn" class="btn dark">저장</button></div>
        <div class="section-title"><span>이 달의 예정지출</span></div><div id="scheduledManagerList"></div>
      </div></div>
      <div id="weeklyBudgetOverlay" class="overlay hidden">
        <div class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="weeklyBudgetOverlayTitle">
          <div class="modal-head"><h2 id="weeklyBudgetOverlayTitle">주간 소비 목표 설정</h2><button type="button" id="weeklyBudgetClose" class="close-x" aria-label="닫기">×</button></div>
          <div class="finance-note">주간 지출은 월요일부터 일요일까지 기록한 지출액의 합계입니다. 월 경계에 걸친 거래도 해당 주에 포함됩니다.</div>
          <div class="field"><label for="weeklyBudgetScope">적용 범위</label>
            <select id="weeklyBudgetScope"><option value="default">모든 주에 적용 (기본 주간 목표)</option><option value="week">현재 선택한 주에만 적용</option></select></div>
          <p id="weeklyBudgetEditorWeek" class="weekly-budget-editor-week"></p>
          <div class="field"><label for="weeklyBudgetAmount">한 주에 쓸 금액 (원)</label>
            <input id="weeklyBudgetAmount" type="number" min="1" max="1000000000" step="1000" inputmode="numeric" placeholder="예: 100000"></div>
          <p id="weeklyBudgetScopeNote" class="finance-note"></p>
          <fieldset class="weekly-filter-pick" aria-labelledby="weeklyFilterLegend">
            <legend id="weeklyFilterLegend">주간 목표에 포함할 지출</legend>
            <p class="finance-note">필수 교통비를 제외하거나 특정 항목만 선택할 수 있어요. 중복되는 항목은 한 번만 계산합니다.</p>
            <div class="weekly-filter-modes">
              <label><input type="radio" name="weeklyFilterMode" id="weeklyFilterAll" value="all" checked> 전체 지출</label>
              <label><input type="radio" name="weeklyFilterMode" id="weeklyFilterSelected" value="selected"> 선택한 항목만</label>
            </div>
            <div id="weeklyBudgetCategoryChoices" class="weekly-filter-catalog"></div>
          </fieldset>
          <div class="btns"><button type="button" id="weeklyBudgetClear" class="btn light">설정 해제</button><button type="button" id="weeklyBudgetSave" class="btn dark">저장</button></div>
        </div>
      </div>`);
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
    on('manageScheduledBtn','click',()=>{resetScheduledForm();$('scheduledManageOverlay').classList.remove('hidden');renderScheduledManager();});
    on('scheduledClose','click',()=>$('scheduledManageOverlay').classList.add('hidden'));
    on('newScheduledBtn','click',resetScheduledForm);
    on('saveScheduledBtn','click',saveScheduled);
    on('deleteScheduledBtn','click',deleteScheduled);
    on('scheduledManageOverlay','click',e=>{if(e.target===$('scheduledManageOverlay'))$('scheduledManageOverlay').classList.add('hidden');});
    on('weeklyBudgetEditBtn','click',openWeeklyBudgetEditor);
    on('weeklyBudgetPrev','click',()=>shiftWeeklyBudgetWeek(-7));
    on('weeklyBudgetNext','click',()=>shiftWeeklyBudgetWeek(7));
    on('weeklyBudgetClose','click',()=>$('weeklyBudgetOverlay').classList.add('hidden'));
    on('weeklyBudgetScope','change',syncWeeklyAmountInput);
    on('weeklyFilterAll','change',()=>{$('weeklyBudgetCategoryChoices').classList.toggle('weekly-filter-inactive',$('weeklyFilterAll').checked)});
    on('weeklyFilterSelected','change',()=>{$('weeklyBudgetCategoryChoices').classList.toggle('weekly-filter-inactive',false)});
    on('weeklyBudgetSave','click',()=>setWeeklyBudget(false));
    on('weeklyBudgetClear','click',()=>setWeeklyBudget(true));
    on('weeklyBudgetOverlay','click',e=>{if(e.target===$('weeklyBudgetOverlay'))$('weeklyBudgetOverlay').classList.add('hidden');});
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
    const activeCount=[q,type,cat,pay,from,to,min!==''?min:'',max!==''?max:''].filter(Boolean).length+(all?1:0);
    $('historyFilterSummaryMeta').textContent=activeCount
      ?`필터 ${activeCount}개 적용 · ${tx.length}건`
      :`선택한 달 · ${tx.length}건`;
    $('historyFilterDetails').classList.toggle('has-active-filter',activeCount>0);
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
    const grade=monthlyFinanceScore(d,s,current,previous);
    const plans=(s.investmentPlans||[]).filter(p=>String(p.targetDate||'').startsWith(month()));
    const invested=plans.filter(p=>p.status==='done').reduce((n,p)=>n+amount(p.amount),0);
    const budget=monthlyInvestmentBudget(month(),d);
    const recurring=current.filter(t=>!!t.recurringSource).reduce((n,t)=>n+amount(t.amount),0);
    const diff=prevExpense>0?Math.round((expense-prevExpense)/prevExpense*100):null;
    const scoreLabel=grade.score==null?'평가 데이터 부족':grade.score>=90?'매우 안정적':grade.score>=80?'양호':grade.score>=70?'보통':grade.score>=60?'주의':'조정 필요';
    const scoreRows=grade.parts.map(p=>`<div class="finance-score-part"><span>${enc(p.key)}<small>${enc(p.detail)}</small></span><b>${Math.round(p.pct)}점</b></div>`).join('');
    $('financeReport').innerHTML=`
      <div class="section-title"><span>월간 재무 성적표</span><small>${enc(month())}</small></div>
      <div class="finance-score-card">
        <div><small>재무 관리 점수</small><strong>${grade.score==null?'—':grade.score}</strong><span>${scoreLabel}</span></div>
        <div class="finance-score-parts">${scoreRows||'<div class="finance-note">월 예산·항목별 예산·전월 데이터·수입 중 하나 이상이 있으면 점수를 계산합니다.</div>'}</div>
      </div>
      <div class="finance-score-caption">가계부에 기록된 데이터만으로 계산한 소비관리 점수입니다. 자산 규모나 투자수익률을 평가하는 점수는 아닙니다.</div>
      <div class="section-title finance-report-subtitle"><span>월간 재무 리포트</span></div>
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
    renderWeeklyBudget();renderScheduledCalendar();renderSearch();renderFixedHome();renderQuickTemplates();renderAssets();renderReport();
  }
  function init(api){
    ctx=api;mount();bind();
  }
  window.BudgetFeatures={
    init,beforeRender,render,mergeSettings,monthlyInvestmentBudget,baseInvestmentBudget,saveInvestmentBudget,markInvestmentPlanDeleted
  };
})();