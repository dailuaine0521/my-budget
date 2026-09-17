(() => {
  'use strict';

  const STORAGE = { salt: 'budget_salt_v1', vault: 'budget_vault_v1', kdf: 'budget_kdf_v2' };
  const LEGACY_ITERATIONS = 250000;
  const STRONG_ITERATIONS = 600000;
  const BACKGROUND_LOCK_MS = 30000;
  const IDLE_LOCK_MS = 5 * 60 * 1000;
  const expenseCats = ['식비','교통','주거/공과금','쇼핑','여가','건강','교육','경조사','구독','기타'];
  const incomeCats = ['급여','용돈/지원','부수입','환급','투자/이자','기타'];

  let key = null;
  let data = null;
  let view = new Date();
  let hiddenAt = 0;
  let lastActivity = Date.now();
  let failedUnlocks = 0;
  let blockedUntil = 0;
  view.setDate(1);

  const $ = id => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytesToB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const b64ToBytes = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

  function currentKdf() {
    try {
      const raw = localStorage.getItem(STORAGE.kdf);
      if (!raw) return { version: 1, iterations: LEGACY_ITERATIONS, hash: 'SHA-256' };
      const parsed = JSON.parse(raw);
      const iterations = Number(parsed.iterations);
      if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) throw new Error('invalid kdf');
      return { version: Number(parsed.version) || 2, iterations, hash: 'SHA-256' };
    } catch {
      return { version: 1, iterations: LEGACY_ITERATIONS, hash: 'SHA-256' };
    }
  }

  async function deriveKey(password, saltB64, iterations) {
    const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptObject(obj, cryptoKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(JSON.stringify(obj)));
    return { iv: bytesToB64(iv), data: bytesToB64(cipher) };
  }

  async function decryptObject(vault, cryptoKey) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(vault.iv) }, cryptoKey, b64ToBytes(vault.data));
    return JSON.parse(dec.decode(plain));
  }

  async function persist() {
    if (!data || !key) return;
    localStorage.setItem(STORAGE.vault, JSON.stringify(await encryptObject(data, key)));
  }

  function passwordIsStrong(password) {
    if (password.length < 10 || password.length > 64) return false;
    const hasLetter = /\p{L}/u.test(password);
    const hasNumber = /\p{N}/u.test(password);
    return (hasLetter && hasNumber) || password.length >= 14;
  }

  function passwordHint() {
    return '10~64자로 입력하세요. 문자+숫자를 함께 쓰거나 14자 이상의 긴 암호문구를 사용하세요.';
  }

  function showOnly(id) {
    ['setup','locked','app'].forEach(x => $(x).classList.add('hidden'));
    $(id).classList.remove('hidden');
  }

  function toast(message, ms = 2200) {
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    setTimeout(() => $('toast').classList.add('hidden'), ms);
  }

  function noteActivity() { lastActivity = Date.now(); }

  async function setup() {
    const first = $('p1').value;
    const second = $('p2').value;
    if (!passwordIsStrong(first)) return toast(passwordHint(), 3500);
    if (first !== second) return toast('두 비밀번호가 서로 다릅니다.');

    const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    key = await deriveKey(first, salt, STRONG_ITERATIONS);
    data = { version: 2, createdAt: new Date().toISOString(), transactions: [] };
    localStorage.setItem(STORAGE.salt, salt);
    localStorage.setItem(STORAGE.kdf, JSON.stringify({ version: 2, iterations: STRONG_ITERATIONS, hash: 'SHA-256' }));
    await persist();
    $('p1').value = $('p2').value = '';
    openApp();
  }

  async function unlock() {
    const now = Date.now();
    if (now < blockedUntil) return toast(`잠시 후 다시 시도하세요. ${Math.ceil((blockedUntil - now) / 1000)}초`);

    const password = $('upin').value;
    const salt = localStorage.getItem(STORAGE.salt);
    const rawVault = localStorage.getItem(STORAGE.vault);
    if (!salt || !rawVault) return showOnly('setup');

    try {
      const kdf = currentKdf();
      const candidate = await deriveKey(password, salt, kdf.iterations);
      const plain = await decryptObject(JSON.parse(rawVault), candidate);
      key = candidate;
      data = plain;
      failedUnlocks = 0;
      blockedUntil = 0;
      $('upin').value = '';
      openApp();
      if (!localStorage.getItem(STORAGE.kdf)) toast('기존 PIN으로 열었습니다. 설정에서 강한 비밀번호로 변경하세요.', 4200);
    } catch {
      failedUnlocks += 1;
      if (failedUnlocks >= 5) {
        blockedUntil = Date.now() + 30000;
        failedUnlocks = 0;
        toast('실패가 반복되어 30초 동안 잠깁니다.', 3500);
      } else {
        toast('비밀번호가 올바르지 않습니다.');
      }
    }
  }

  function openApp() {
    showOnly('app');
    view = new Date();
    view.setDate(1);
    noteActivity();
    render();
  }

  function lockNow(message = '') {
    key = null;
    data = null;
    $('settingsOverlay').classList.add('hidden');
    $('txOverlay').classList.add('hidden');
    $('passwordOverlay').classList.add('hidden');
    showOnly('locked');
    $('legacyNotice').classList.toggle('hidden', Boolean(localStorage.getItem(STORAGE.kdf)));
    if (message) toast(message);
  }

  const won = n => new Intl.NumberFormat('ko-KR').format(Math.round(n)) + '원';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function render() {
    if (!data) return;
    const m = monthKey(view);
    const tx = [...data.transactions]
      .filter(t => t.date.startsWith(m))
      .sort((a,b) => b.date.localeCompare(a.date) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const income = tx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expense = tx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    const balance = income - expense;

    $('monthLabel').textContent = `${view.getFullYear()}년 ${view.getMonth()+1}월`;
    $('sumIn').textContent = won(income);
    $('sumOut').textContent = won(expense);
    $('sumBal').textContent = won(balance);
    $('sumBal').classList.toggle('negative', balance < 0);
    $('count').textContent = `${tx.length}건`;

    const box = $('list');
    box.innerHTML = '';
    if (!tx.length) {
      box.innerHTML = '<div class="empty">이 달에 기록된 내역이 없습니다.<br>위 버튼으로 첫 내역을 추가해보세요.</div>';
      return;
    }

    const groups = {};
    tx.forEach(t => (groups[t.date] ??= []).push(t));
    Object.keys(groups).sort((a,b) => b.localeCompare(a)).forEach(date => {
      const d = new Date(date + 'T00:00:00');
      const weekday = ['일','월','화','수','목','금','토'][d.getDay()];
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="day">${d.getMonth()+1}월 ${d.getDate()}일 (${weekday})</div>`;
      groups[date].forEach(t => {
        const row = document.createElement('button');
        const sign = t.type === 'expense' ? '-' : '+';
        row.className = `tx ${t.type}`;
        row.innerHTML = `<span class="dot"></span><span class="txm"><span class="txn">${escapeHtml(t.title || t.category)}</span><span class="meta">${escapeHtml(t.category)}${t.payment ? ' · ' + escapeHtml(t.payment) : ''}</span></span><span class="amt">${sign}${won(t.amount)}</span>`;
        row.addEventListener('click', () => openTx(t.type, t));
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    });
  }

  function fillCats(type, selected) {
    const cats = type === 'expense' ? expenseCats : incomeCats;
    $('cat').innerHTML = cats.map(c => `<option ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }

  function openTx(type, tx = null) {
    $('type').value = type;
    $('id').value = tx?.id || '';
    $('txTitle').textContent = tx ? '내역 수정' : (type === 'expense' ? '지출 기록' : '수입 기록');
    $('date').value = tx?.date || ymd(new Date());
    $('amount').value = tx?.amount ?? '';
    $('title').value = tx?.title ?? '';
    $('memo').value = tx?.memo ?? '';
    $('pay').value = tx?.payment ?? '카드';
    fillCats(type, tx?.category);
    $('payField').classList.toggle('hidden', type === 'income');
    $('delWrap').classList.toggle('hidden', !tx);
    $('txOverlay').classList.remove('hidden');
    setTimeout(() => $('amount').focus(), 80);
  }

  async function saveTx() {
    const type = $('type').value;
    const amount = Number($('amount').value);
    const date = $('date').value;
    if (!date) return toast('날짜를 선택하세요.');
    if (!Number.isFinite(amount) || amount <= 0) return toast('금액을 입력하세요.');

    const id = $('id').value || crypto.randomUUID();
    const old = data.transactions.find(t => t.id === id);
    const item = {
      id, type, date, amount,
      category: $('cat').value,
      payment: type === 'expense' ? $('pay').value : '',
      title: $('title').value.trim() || $('cat').value,
      memo: $('memo').value.trim(),
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const index = data.transactions.findIndex(t => t.id === id);
    if (index >= 0) data.transactions[index] = item;
    else data.transactions.push(item);
    await persist();
    $('txOverlay').classList.add('hidden');
    view = new Date(date + 'T00:00:00');
    view.setDate(1);
    render();
    toast('저장했습니다.');
  }

  async function deleteTx() {
    const id = $('id').value;
    if (!id || !confirm('이 내역을 삭제할까요?')) return;
    data.transactions = data.transactions.filter(t => t.id !== id);
    await persist();
    $('txOverlay').classList.add('hidden');
    render();
    toast('삭제했습니다.');
  }

  function download(name, blob) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function backup() {
    const payload = {
      app: 'private-household-budget', version: 2, exportedAt: new Date().toISOString(),
      salt: localStorage.getItem(STORAGE.salt),
      kdf: currentKdf(),
      vault: JSON.parse(localStorage.getItem(STORAGE.vault))
    };
    download(`가계부_암호화백업_${ymd(new Date()).replaceAll('-','')}.json`, new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
    toast('암호화 백업을 저장했습니다.');
  }

  function exportCsv() {
    const rows = [['구분','날짜','카테고리','내용','금액','결제수단','메모']];
    [...data.transactions].sort((a,b) => a.date.localeCompare(b.date)).forEach(t => rows.push([t.type === 'expense' ? '지출' : '수입', t.date, t.category, t.title, t.amount, t.payment || '', t.memo || '']));
    const q = v => `"${String(v ?? '').replaceAll('"','""')}"`;
    const content = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n');
    download(`가계부_${ymd(new Date()).replaceAll('-','')}.csv`, new Blob([content], {type:'text/csv;charset=utf-8'}));
    toast('CSV를 저장했습니다. 평문 파일이므로 보관에 주의하세요.', 3500);
  }

  async function restoreFile(file) {
    try {
      const obj = JSON.parse(await file.text());
      if (obj.app !== 'private-household-budget' || !obj.salt || !obj.vault) throw new Error('invalid backup');
      localStorage.setItem(STORAGE.salt, obj.salt);
      localStorage.setItem(STORAGE.vault, JSON.stringify(obj.vault));
      if (obj.kdf?.iterations) localStorage.setItem(STORAGE.kdf, JSON.stringify({version: Number(obj.kdf.version) || 2, iterations: Number(obj.kdf.iterations), hash:'SHA-256'}));
      else localStorage.removeItem(STORAGE.kdf);
      key = null;
      data = null;
      $('settingsOverlay').classList.add('hidden');
      showOnly('locked');
      $('legacyNotice').classList.toggle('hidden', Boolean(localStorage.getItem(STORAGE.kdf)));
      toast('복원했습니다. 백업 당시 비밀번호/PIN을 입력하세요.', 3500);
    } catch {
      toast('올바른 암호화 백업 파일이 아닙니다.');
    }
  }

  async function changePassword() {
    const current = $('currentPassword').value;
    const next = $('newPassword').value;
    const next2 = $('newPassword2').value;
    if (!passwordIsStrong(next)) return toast(passwordHint(), 3500);
    if (next !== next2) return toast('새 비밀번호 두 개가 서로 다릅니다.');
    if (current === next) return toast('현재 비밀번호와 다른 비밀번호를 사용하세요.');

    try {
      const salt = localStorage.getItem(STORAGE.salt);
      const vault = JSON.parse(localStorage.getItem(STORAGE.vault));
      const oldKdf = currentKdf();
      const oldKey = await deriveKey(current, salt, oldKdf.iterations);
      await decryptObject(vault, oldKey);

      const newSalt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
      const newKey = await deriveKey(next, newSalt, STRONG_ITERATIONS);
      const newVault = await encryptObject(data, newKey);
      localStorage.setItem(STORAGE.salt, newSalt);
      localStorage.setItem(STORAGE.kdf, JSON.stringify({version:2, iterations:STRONG_ITERATIONS, hash:'SHA-256'}));
      localStorage.setItem(STORAGE.vault, JSON.stringify(newVault));
      key = newKey;
      $('currentPassword').value = $('newPassword').value = $('newPassword2').value = '';
      $('passwordOverlay').classList.add('hidden');
      toast('비밀번호와 암호화 설정을 강화했습니다.', 3200);
    } catch {
      toast('현재 비밀번호/PIN이 올바르지 않습니다.');
    }
  }

  $('setupBtn').addEventListener('click', setup);
  $('unlockBtn').addEventListener('click', unlock);
  $('upin').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  $('p2').addEventListener('keydown', e => { if (e.key === 'Enter') setup(); });
  $('addOut').addEventListener('click', () => openTx('expense'));
  $('addIn').addEventListener('click', () => openTx('income'));
  $('cancelBtn').addEventListener('click', () => $('txOverlay').classList.add('hidden'));
  $('saveBtn').addEventListener('click', saveTx);
  $('deleteBtn').addEventListener('click', deleteTx);
  $('prev').addEventListener('click', () => { view.setMonth(view.getMonth()-1); render(); });
  $('next').addEventListener('click', () => { view.setMonth(view.getMonth()+1); render(); });
  $('settingsBtn').addEventListener('click', () => $('settingsOverlay').classList.remove('hidden'));
  $('closeSettings').addEventListener('click', () => $('settingsOverlay').classList.add('hidden'));
  $('lockBtn').addEventListener('click', () => lockNow('가계부를 잠갔습니다.'));
  $('backupBtn').addEventListener('click', backup);
  $('csvBtn').addEventListener('click', exportCsv);
  $('restoreBtn').addEventListener('click', () => $('restoreInput').click());
  $('restoreInput').addEventListener('change', e => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ''; });
  $('restoreLockBtn').addEventListener('click', () => $('restoreLockInput').click());
  $('restoreLockInput').addEventListener('change', e => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ''; });
  $('changePasswordBtn').addEventListener('click', () => { $('settingsOverlay').classList.add('hidden'); $('passwordOverlay').classList.remove('hidden'); $('currentPassword').focus(); });
  $('cancelPasswordBtn').addEventListener('click', () => { $('passwordOverlay').classList.add('hidden'); $('settingsOverlay').classList.remove('hidden'); });
  $('savePasswordBtn').addEventListener('click', changePassword);

  ['pointerdown','keydown','touchstart','scroll'].forEach(eventName => document.addEventListener(eventName, noteActivity, {passive:true}));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (data && hiddenAt && Date.now() - hiddenAt >= BACKGROUND_LOCK_MS) lockNow('30초 이상 자리를 비워 자동으로 잠겼습니다.');
  });
  setInterval(() => {
    if (data && Date.now() - lastActivity >= IDLE_LOCK_MS) lockNow('5분간 사용하지 않아 자동으로 잠겼습니다.');
  }, 15000);

  if (!window.crypto?.subtle) alert('최신 Safari 또는 Chrome에서 열어주세요.');
  const exists = localStorage.getItem(STORAGE.salt) && localStorage.getItem(STORAGE.vault);
  $('legacyNotice').classList.toggle('hidden', Boolean(localStorage.getItem(STORAGE.kdf)));
  showOnly(exists ? 'locked' : 'setup');
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
})();