(function captureBatchPlugin() {
  'use strict';
  let api=null, scanBusy=false, draft=[], rawText='';
  const $=id=>document.getElementById(id);
  const enc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now=()=>new Date().toISOString();
  const won=n=>Math.round(Number(n)||0).toLocaleString('ko-KR')+'원';
  const expenseCats=['식비','카페','편의점','교통','주거/공과금','쇼핑','여가','건강','교육','경조사','구독','기타'];
  const incomeCats=['급여','용돈/지원','부수입','환급','투자/이자','기타'];
  const payOptions=['카드','현금','계좌이체','간편결제','토스','네이버페이','카카오페이','지역화폐','기타'];
  const mealOptions=['아침','점심','저녁','술'];
  const situationOptions=['혼밥','직장','데이트'];

  function validDate(s) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;
    const [y,m,d]=s.split('-').map(Number),check=new Date(y,m-1,d,12);
    return check.getFullYear()===y&&check.getMonth()+1===m&&check.getDate()===d;
  }
  function dateFromLine(line,yearFallback) {
    const s=String(line||'');
    let m=s.match(/(?:^|[^\d])(20\d{2})\s*(?:[.\-/년])\s*(\d{1,2})\s*(?:[.\-/월])\s*(\d{1,2})\s*일?(?!\d)/);
    if(m){
      const d=`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
      return validDate(d)?d:null;
    }
    m=s.match(/(?:^|[^\d])(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*일?(?!\d)/);
    if(m){
      const d=`${yearFallback}-${pad(+m[1])}-${pad(+m[2])}`;
      return validDate(d)?d:null;
    }
    return null;
  }
  function cleanDateTime(s){
    return String(s||'')
      .replace(/20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g,' ')
      .replace(/(?:^|\s)\d{1,2}\s*(?:월|[./-])\s*\d{1,2}\s*일?(?=\s|$)/g,' ')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g,' ')
      .replace(/\s+/g,' ').trim();
  }
  function moneyCandidates(line){
    const stripped=cleanDateTime(line).replace(/(?:20\d{2}년|20\d{2}\s*(?:[./-]\s*\d{1,2})?)/g,s=>s.length>=4?' ':s);
    const re=/(?:^|[^\dA-Za-z가-힣])([+\-−]?)([₩￦]?)\s*(\d{1,3}(?:,\d{3})+|\d{3,8})(\s*원)?(?![\d.\/:-])/g;
    const candidates=[];
    for(const m of stripped.matchAll(re)){
      const start=m.index+(m[0].length-m[0].trimStart().length),value=Number(m[3].replaceAll(',',''));
      if(!Number.isSafeInteger(value)||value<100||value>100000000)continue;
      const around=stripped.slice(Math.max(0,m.index-16),m.index).replace(/\s+/g,'');
      if(/(?:잔액|포인트|적립|할인|할부|카드번호|계좌|주문번호|승인번호|부가세|세액|보유액|예상)/.test(around.slice(-8)))continue;
      if(!m[3].includes(',')&&!m[4]&&!m[2]&&!m[1]&&
         !/(?:결제|출금|입금|승인|이용|송금|구매|금액)/.test(stripped)&&
         !/[가-힣A-Za-z]/.test(stripped.replace(m[0],'')))continue;
      candidates.push({value,token:m[0],at:m.index,sign:m[1]||''});
    }
    return candidates;
  }
  function cleanMerchant(raw,money){
    let s=cleanDateTime(raw);
    if(money)s=s.replace(money.token,' ');
    s=s.replace(/[₩￦]\s*\d[\d,]*\s*원?/g,' ');
    s=s.replace(/\b(?:승인|출금|입금|결제완료|결제|이체|거래금액|승인금액|이용금액|결제금액|금액|받은 금액|보낸 금액|사용|완료|일시|시간|승인일시)\b/gi,' ');
    s=s.replace(/(?:금액|결제|승인|입금|출금)\s*[:：]/gi,' ');
    s=s.replace(/[•·|]+/g,' ').replace(/^[\-+,:：\s]+|[\-+,:：\s]+$/g,'').replace(/\s+/g,' ').trim();
    return s.slice(0,85);
  }
  function skippedLine(line){
    return /^(?:합계|총액|총 결제|총결제|전체|결제합계|합계금액|지출합계|입금합계|잔액|현재잔액|잔고|포인트|적립|할인|할부|누적|누계|이용한도|결제예정|청구예정|청구금액|예상|이번달사용|이번 달 사용|이번 주 사용|월 사용액|사용금액|월간합계|기간합계|상세내역|카드번호|계좌번호|승인번호|주문번호|전월|이월|소계|부가세|세액|현금영수증|할인금액)/i.test(String(line).trim())||
      /^(?:거래내역|이용내역|입출금 내역|지출내역|사용내역|상품명|품명|단가|수량|날짜|일시|이번 달|이번 주|합산|카드 이용내역|월간 리포트)$/i.test(String(line).trim());
  }
  function meaningfulName(line){
    const s=cleanMerchant(line);
    if(!s||s.length<2||s.length>70||skippedLine(s))return false;
    if(/^(?:\d+|[가-힣A-Za-z]*\s*(?:금액|결제|승인|입금|출금|원|오전|오후)\s*)$/i.test(s))return false;
    if(/^20\d{2}$/.test(s)||/^\d+월$/.test(s)||/^\d{1,2}:\d{2}/.test(s))return false;
    return /[가-힣A-Za-z]/.test(s);
  }
  function inferType(line){
    const s=String(line||'');
    if(/환불|입금|받은금액|송금받|급여|수입|이자\s*입금|캐시백/i.test(s)&&!/환불금액 제외/i.test(s))return 'income';
    return 'expense';
  }
  function rowId(row){
    return [row.date,row.type,Number(row.amount),String(row.title||'').replace(/[\s\-_.()[\]]/g,'').toLowerCase()].join('|');
  }
  function parseEntries(text,baseDate){
    const raw=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
    const safeDate=validDate(baseDate)?baseDate:ymd(new Date());
    let y=Number(safeDate.slice(0,4)),date=safeDate,dateKnown=false,pending=null,justSawAmount=false;
    const result=[],warnings=[];
    for(let i=0;i<raw.length&&i<500;i++){
      const line=raw[i];const fullYear=line.match(/(?:^|[^\d])(20\d{2})\s*년/);
      if(fullYear)y=Number(fullYear[1]);
      const rowDate=dateFromLine(line,y);
      if(rowDate){date=rowDate;dateKnown=true;y=Number(date.slice(0,4));}
      if(skippedLine(line)){pending=null;justSawAmount=false;continue;}
      const amounts=moneyCandidates(line);
      if(!amounts.length){
        const candidate=cleanMerchant(line);
        if(meaningfulName(line)&&(!rowDate||candidate)){
          pending={text:candidate,index:i,date};
          justSawAmount=false;
        }
        continue;
      }
      const amount=amounts[0],onLine=cleanMerchant(line,amount);
      // The nearest merchant description belongs to this amount only.
      const preceding=pending&&i-pending.index<=2&&!justSawAmount?pending.text:'';
      const title=meaningfulName(onLine)?onLine:preceding;
      if(!title&&!rowDate&&!preceding){pending=null;continue;}
      const type=inferType(line+' '+(preceding||''));
      const cleanTitle=title||'거래 내용 확인 필요';
      let category=type==='income'?(incomeCats.includes('환급')&&/환불|환급/.test(line)?'환급':'기타')
        :(api?.detectCategory?.(cleanTitle||line)||'기타');
      let detail=type==='expense'?(api?.detectDetail?.(category,cleanTitle+' '+line)||''):'';
      let payment=type==='expense'?(/카카오\s*페이|네이버\s*페이|토스|toss|지역화폐|지역사랑상품권|지역상품권/i.test(line)?api?.detectPayment?.(line)||'간편결제':/계좌이체|송금|이체/.test(line)?'계좌이체':/현금/.test(line)?'현금':'카드'):'';
      let meal=category==='식비'?api?.detectMeal?.(cleanTitle+' '+line)||'저녁':'';
      let foodContext=category==='식비'?'혼밥':'',subDetail='',classificationSource='rules';
      if(type==='expense'&&title&&api?.classifyMerchant){
        const learned=api.classifyMerchant(cleanTitle,{category,detail,payment,meal,foodContext,subDetail});
        category=learned.category||category;detail=learned.detail||'';payment=learned.payment||payment;meal=learned.meal||meal;
        foodContext=learned.foodContext||foodContext;subDetail=learned.subDetail||'';classificationSource=learned.classificationSource||'rules';
      }
      result.push({selected:!!title,date,assumedDate:!dateKnown,title:cleanTitle,amount:amount.value,type,category,detail,
        subDetail,payment,meal,foodContext,classificationSource,
        sourceLine:line,needsReview:!title});
      pending=null;justSawAmount=true;
    }
    if(!result.length&&raw.length)warnings.push('거래를 자동으로 분리하지 못했습니다. 원문을 수정하거나 행을 직접 추가해 주세요.');
    const seen=new Set();
    for(const row of result){
      const key=rowId(row);
      if(seen.has(key)){row.selected=false;row.duplicateInScan=true;}
      else seen.add(key);
    }
    return{rows:result.slice(0,120),warnings,rawLines:raw.length};
  }

  function markKnownDuplicates(){
    const items=api?.getData()?.transactions||[];
    const seen=new Set(items.map(rowId));
    for(const row of draft)row.exists=seen.has(rowId(row));
  }
  function createEmptyRow(){
    return {selected:true,date:ymd(new Date()),assumedDate:true,title:'',amount:0,type:'expense',category:'기타',detail:'',
      subDetail:'',payment:'카드',meal:'저녁',foodContext:'혼밥',sourceLine:'수동 추가',needsReview:false};
  }
  function candidateOptions(options,value){
    return options.map(x=>`<option value="${enc(x)}"${x===value?' selected':''}>${enc(x)}</option>`).join('');
  }
  function fieldsForRow(row,index){
    const categories=row.type==='income'?incomeCats:expenseCats;
    if(!categories.includes(row.category))row.category=categories[categories.length-1];
    const availableDetail=api?.detailMap?.[row.category]||[];
    const detailOptions=['',...availableDetail];if(row.detail&&!detailOptions.includes(row.detail))detailOptions.push(row.detail);
    return `<article class="ocr-row${row.exists?' ocr-already-present':''}" data-ocr-row="${index}">
      <header class="ocr-row-top">
        <label class="ocr-include"><input class="ocr-selected" type="checkbox"${row.selected?' checked':''}> <b>${index+1}번 거래</b></label>
        <span class="ocr-row-warning">${row.exists?'⚠ 기존 기록과 같음':row.duplicateInScan?'⚠ 이미지 내 중복':row.needsReview?'⚠ 거래명 확인 필요':row.assumedDate?'⚠ 날짜 확인':row.classificationSource?.startsWith('learned')?'✓ 이전 분류 자동 적용':''}</span>
        <button type="button" class="ocr-remove" data-ocr-remove="${index}" aria-label="${index+1}번 후보 삭제">×</button>
      </header>
      <div class="ocr-row-fields">
        <label>날짜<input type="date" class="ocr-date" value="${enc(row.date)}"></label>
        <label>구분<select class="ocr-type"><option value="expense"${row.type==='expense'?' selected':''}>지출</option><option value="income"${row.type==='income'?' selected':''}>수입</option></select></label>
        <label class="ocr-wide">거래명<input class="ocr-title" maxlength="100" placeholder="거래명 확인" value="${enc(row.title)}"></label>
        <label>금액(원)<input class="ocr-amount" type="number" min="100" max="100000000" step="1" inputmode="numeric" value="${Number(row.amount)||''}"></label>
        <label>카테고리<select class="ocr-category">${candidateOptions(categories,row.category)}</select></label>
        <label>세부항목<select class="ocr-detail">${candidateOptions(detailOptions,row.detail)}</select></label>
        <label>결제수단<select class="ocr-payment">${candidateOptions(payOptions,row.payment||'카드')}</select></label>
        <label class="ocr-food-field">식사 구분<select class="ocr-meal">${candidateOptions(mealOptions,row.meal||'저녁')}</select></label>
        <label class="ocr-food-field">식사 상황<select class="ocr-food-context">${candidateOptions(situationOptions,row.foodContext||'혼밥')}</select></label>
      </div>
      ${row.sourceLine?`<p class="ocr-source">원문: ${enc(row.sourceLine)}</p>`:''}
    </article>`;
  }
  function bindRowState(article,index){
    const row=draft[index],selector=key=>article.querySelector('.'+key);
    const fields={selected:'ocr-selected',date:'ocr-date',type:'ocr-type',title:'ocr-title',amount:'ocr-amount',
      category:'ocr-category',detail:'ocr-detail',payment:'ocr-payment',meal:'ocr-meal',foodContext:'ocr-food-context'};
    const refreshVisibility=()=>{
      const isExpense=row.type==='expense',isFood=isExpense&&row.category==='식비';
      selector('ocr-category').disabled=false;
      selector('ocr-detail').closest('label').classList.toggle('hidden',!isExpense);
      selector('ocr-payment').closest('label').classList.toggle('hidden',!isExpense);
      article.querySelectorAll('.ocr-food-field').forEach(x=>x.classList.toggle('hidden',!isFood));
      selector('ocr-category').innerHTML=candidateOptions(isExpense?expenseCats:incomeCats,row.category);
      const opts=['',...(api?.detailMap?.[row.category]||[])];
      if(row.detail&&!opts.includes(row.detail))opts.push(row.detail);
      selector('ocr-detail').innerHTML=candidateOptions(opts,row.detail);
    };
    for(const [key,cls] of Object.entries(fields)){
      const el=selector(cls);
      el.addEventListener(key==='selected'||el.tagName==='SELECT'?'change':'input',()=>{
        row[key]=key==='selected'?el.checked:key==='amount'?el.value:el.value;
        if(key==='type'){
          row.category=row.type==='income'?'기타':'기타';row.detail='';row.payment=row.type==='expense'?'카드':'';
          refreshVisibility();
        }else if(key==='category'){row.detail='';refreshVisibility();}
        else if(key==='detail')row.detail=el.value;
        updateCount();
      });
    }
    refreshVisibility();
  }
  function updateCount(){
    const chosen=draft.filter(r=>r.selected);
    const total=chosen.reduce((n,r)=>n+(Number(r.amount)||0),0);
    $('ocrBatchSelected').textContent=`선택 ${chosen.length}건 · 금액 합계 ${won(total)}`;
    $('ocrBatchSave').disabled=scanBusy||chosen.length===0;
  }
  function renderDraft(){
    markKnownDuplicates();
    const box=$('ocrBatchRows');
    box.innerHTML=draft.length?draft.map(fieldsForRow).join(''):'<div class="empty compact">추출된 거래가 없습니다. 행을 직접 추가하거나 아래 인식 원문을 수정해 주세요.</div>';
    box.querySelectorAll('[data-ocr-row]').forEach(article=>bindRowState(article,Number(article.dataset.ocrRow)));
    box.querySelectorAll('[data-ocr-remove]').forEach(btn=>btn.addEventListener('click',()=>{
      draft.splice(Number(btn.dataset.ocrRemove),1);
      renderDraft();
    }));
    $('ocrBatchFound').textContent=`인식된 거래 ${draft.length}건 · 저장 전 확인`;
    updateCount();
  }
  function closeReview(){
    $('ocrBatchOverlay').classList.add('hidden');
    draft=[];rawText='';
    $('scanStatus').textContent='';
    $('scanStatus').classList.add('hidden');
    $('scanBtn').focus();
  }
  function openReview(text) {
    rawText=text;
    const parsed=parseEntries(text,api?.rememberedDate?.()||ymd(new Date()));
    draft=parsed.rows;
    markKnownDuplicates();
    for(const r of draft)if(r.exists)r.selected=false;
    $('ocrBatchRawText').value=text;
    $('ocrBatchNote').textContent=parsed.warnings[0]||
      '이미지 인식은 날짜·금액·거래명이 틀릴 수 있어요. 저장할 항목을 선택하고 반드시 내용을 확인해 주세요. 식비 기본값은 저녁·혼밥입니다.';
    $('ocrBatchOverlay').classList.remove('hidden');
    renderDraft();
    $('ocrBatchCancel').focus();
  }
  async function scanImage(file){
    if(!file||scanBusy)return;
    if(!window.Tesseract){api.toast('문자 인식 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',3500);return;}
    scanBusy=true;$('scanBtn').disabled=true;
    $('scanStatus').classList.remove('hidden');
    $('scanStatus').textContent='이미지에서 모든 거래 항목을 읽는 중...';
    api?.touch?.();
    try{
      const result=await Tesseract.recognize(file,'kor+eng',{
        workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        langPath:'https://tessdata.projectnaptha.com/4.0.0',
        logger:m=>{
          api?.touch?.();
          if(m.status==='recognizing text')$('scanStatus').textContent=`전체 거래 OCR 인식 중 ${Math.round((m.progress||0)*100)}%`;
        }
      });
      const text=result?.data?.text||'';
      if(!text.trim())throw new Error('이미지에서 읽힌 문자가 없습니다.');
      openReview(text);
      $('scanStatus').textContent=`이미지 인식 완료 · 거래 ${draft.length}건 후보 발견`;
    }catch(e){
      console.error('OCR batch',e);
      $('scanStatus').textContent='캡처 인식 실패: '+String(e.message||'이미지를 확인해 주세요.');
      api.toast('이미지를 다시 촬영하거나 선명한 화면을 사용해 주세요.',3000);
    }finally{
      scanBusy=false;$('scanBtn').disabled=false;$('scanInput').value='';
      api?.touch?.();
    }
  }
  async function saveSelected(){
    if(scanBusy)return;
    const included=draft.filter(x=>x.selected);
    if(!included.length)return api.toast('저장할 거래를 선택하세요.');
    const prepared=[];
    for(const row of included){
      const n=Number(row.amount),title=String(row.title||'').trim(),date=String(row.date||'');
      if(!validDate(date)||!Number.isSafeInteger(n)||n<100||n>100000000||!title||title==='거래 내용 확인 필요'){
        return api.toast('선택한 거래의 날짜·거래명·금액을 확인해 주세요.',3500);
      }
      const type=row.type==='income'?'income':'expense',category=(type==='expense'?expenseCats:incomeCats).includes(row.category)?row.category:'기타';
      const info=type==='expense'?(api?.detailMap?.[category]||[]):[];
      const detail=info.includes(row.detail)?row.detail:'';
      const isFood=type==='expense'&&category==='식비',time=now();
      prepared.push({id:crypto.randomUUID(),type,date,amount:n,category,
        detail,subDetail:row.subDetail||'',meal:isFood?(mealOptions.includes(row.meal)?row.meal:'저녁'):'',
        foodContext:isFood?(situationOptions.includes(row.foodContext)?row.foodContext:'혼밥'):'',
        payment:type==='expense'?row.payment||'카드':'',title,memo:'캡처 일괄 인식 (확인 후 저장)',
        createdAt:time,updatedAt:time});
    }
    const existingIds=new Set((api.getData()?.transactions||[]).map(rowId));
    const duplicateCount=prepared.filter(row=>existingIds.has(rowId(row))).length;
    if(duplicateCount&&!confirm(`기존 가계부와 날짜·거래명·금액이 같은 거래가 ${duplicateCount}건 있습니다. 그래도 선택한 전체 항목을 추가할까요?`))return;
    const localDup=prepared.length-new Set(prepared.map(rowId)).size;
    if(localDup&&!confirm(`이번 추가 목록에 날짜·거래명·금액이 같은 항목이 ${localDup}건 있습니다. 실제 중복이 아닌지 확인했나요?`))return;
    if(!confirm(`${prepared.length}건을 합계 ${won(prepared.reduce((n,r)=>n+r.amount,0))}으로 가계부에 추가할까요?`))return;
    scanBusy=true;$('ocrBatchSave').disabled=true;
    const data=api.getData();
    data.transactions.push(...prepared);
    try{
      await api.persist();
      let learned=0;
      if(api?.rememberMerchantProfile){
        for(const item of prepared)if(api.rememberMerchantProfile(item))learned++;
        if(learned)await api.persist({sync:false});
      }
      closeReview();api.renderAll();
      api.toast(`${prepared.length}건을 저장했고 가맹점 분류 ${learned}건을 학습했습니다.`,3500);
    }catch(error){
      const inserted=new Set(prepared.map(x=>x.id));
      data.transactions=data.transactions.filter(x=>!inserted.has(x.id));
      console.error('OCR batch save',error);
      api.toast('저장하지 못했습니다. 네트워크와 잠금 상태를 확인하세요.',3500);
    }finally{
      scanBusy=false;updateCount();
    }
  }
  function mount(){
    document.body.insertAdjacentHTML('beforeend',`
      <div id="ocrBatchOverlay" class="overlay hidden">
        <div class="modal ocr-batch-modal" role="dialog" aria-modal="true" aria-labelledby="ocrBatchHeading">
          <div class="modal-head"><div><div class="eyebrow">CAPTURE IMPORT</div><h2 id="ocrBatchHeading">캡처의 거래 모두 추가</h2></div>
            <button type="button" id="ocrBatchCancel" class="close-x" aria-label="추가 취소">×</button></div>
          <p id="ocrBatchNote" class="finance-note"></p>
          <div class="ocr-summary"><b id="ocrBatchFound">분석 중</b><span id="ocrBatchSelected"></span></div>
          <div class="ocr-controls">
            <button type="button" id="ocrSelectAll">전체 선택</button>
            <button type="button" id="ocrDeselectAll">모두 해제</button>
            <button type="button" id="ocrAddManual">+ 누락 항목 추가</button>
          </div>
          <div id="ocrBatchRows"></div>
          <details class="ocr-raw"><summary>인식된 원문 보기·수정 (누락되면 여기서 고쳐서 재분석)</summary>
            <textarea id="ocrBatchRawText" rows="8" spellcheck="false" aria-label="OCR 인식 원문"></textarea>
            <button type="button" class="btn light full" id="ocrReparse">수정된 텍스트로 다시 분석</button>
          </details>
          <div class="ocr-footer">
            <button type="button" id="ocrBatchClose" class="btn light">취소</button>
            <button type="button" id="ocrBatchSave" class="btn dark">선택 항목 저장</button>
          </div>
        </div>
      </div>`);
    const on=(id,fn)=>$(id).addEventListener('click',fn);
    on('ocrBatchClose',closeReview);
    on('ocrBatchCancel',closeReview);
    on('ocrSelectAll',()=>{draft.forEach(r=>r.selected=true);renderDraft()});
    on('ocrDeselectAll',()=>{draft.forEach(r=>r.selected=false);renderDraft()});
    on('ocrAddManual',()=>{if(draft.length>=150)return api.toast('한 번에 최대 150개까지 추가할 수 있습니다.');draft.push(createEmptyRow());renderDraft();$('ocrBatchRows').lastElementChild?.scrollIntoView({block:'nearest'})});
    on('ocrReparse',()=>{
      if(draft.some(r=>r.selected)&&!confirm('수정 중인 거래 후보 목록이 새 분석으로 바뀝니다. 계속할까요?'))return;
      openReview($('ocrBatchRawText').value);
    });
    on('ocrBatchSave',saveSelected);
    $('ocrBatchOverlay').addEventListener('click',e=>{if(e.target===$('ocrBatchOverlay'))closeReview()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('ocrBatchOverlay').classList.contains('hidden')){e.preventDefault();closeReview()}});
  }
  function init(applicationApi){
    api=applicationApi;
    mount();
  }
  window.BudgetOCRBatch={init,scanImage};
})();