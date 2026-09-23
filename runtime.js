(function () {
  'use strict';
  const MAX_BYTES = 4 * 1024 * 1024;
  const MAX_BACKUP_BYTES = MAX_BYTES + 1024;
  const MAX_RECIPES = 500;
  const defaultState = () => ({v:1, revision:0, sort:'material', tab:'all', query:'', kind:'', materials:[], match:'all', favorites:[], custom:[], customItems:[], customIcons:{}});
  function requireValue(condition, message) { if (!condition) throw new Error(message); }
  function text(value, limit = 500) { return typeof value === 'string' && value.length <= limit; }
  function itemID(value) { return text(value, 200) && /^[a-z0-9_.-]+:[a-z0-9/._#:-]+$/.test(value); }
  function ingredient(value) {
    requireValue(value && Array.isArray(value.options) && value.options.length > 0 && value.options.length <= 2000 && value.options.every(itemID), '재료 정보가 올바르지 않습니다.');
    requireValue(value.label == null || text(value.label, 500), '재료 이름이 너무 깁니다.');
    return {options: [...value.options], label: value.label || ''};
  }
  function validateSnapshot(snapshot) {
    requireValue(snapshot && snapshot.privateContent && snapshot.privateContent.craftPocket, '주머니 제작대 웹앱 백업 파일이 아닙니다.');
    const saved = snapshot.privateContent.craftPocket;
    requireValue(saved.v === 1, '지원하지 않는 백업 버전입니다.');
    for (const key of ['custom','customItems','favorites','materials']) requireValue(Array.isArray(saved[key]), '백업 목록 형식이 올바르지 않습니다.');
    requireValue(saved.custom.length <= MAX_RECIPES && saved.customItems.length <= 2000 && saved.favorites.length <= 10000 && saved.materials.length <= 2000, '백업 목록이 너무 큽니다.');
    const custom = saved.custom.map(recipe => {
      requireValue(recipe && itemID(recipe.id) && recipe.id.startsWith('custom:') && itemID(recipe.result), '사용자 조합법 ID가 올바르지 않습니다.');
      requireValue(['crafting_shaped','crafting_shapeless','smelting','stonecutting','custom_machine'].includes(recipe.kind), '지원하지 않는 사용자 제작 방식입니다.');
      requireValue(Number.isInteger(recipe.count) && recipe.count >= 1 && recipe.count <= 999, '제작 수량이 올바르지 않습니다.');
      requireValue(Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 && recipe.ingredients.length <= 256, '필요한 재료 목록이 올바르지 않습니다.');
      requireValue(text(recipe.notes || '', 500) && text(recipe.mod || '', 100), '조합법 메모가 너무 깁니다.');
      const ingredients = recipe.ingredients.map(ingredient);
      let grid = null;
      if (recipe.kind === 'crafting_shaped') {
        requireValue(Array.isArray(recipe.grid) && recipe.grid.length === 9, '제작대 배치가 올바르지 않습니다.');
        grid = recipe.grid.map(value => value === null ? null : ingredient(value));
        requireValue(JSON.stringify(grid.filter(Boolean)) === JSON.stringify(ingredients), '제작대 배치와 재료 목록이 다릅니다.');
      }
      if (recipe.kind === 'crafting_shapeless') requireValue(ingredients.length <= 9, '제작대에는 재료를 9칸까지 넣을 수 있습니다.');
      if (['smelting','stonecutting'].includes(recipe.kind)) requireValue(ingredients.length === 1, '이 제작 방식에는 재료가 하나 필요합니다.');
      return {id:recipe.id, result:recipe.result, kind:recipe.kind, count:recipe.count, ingredients, grid, notes:recipe.notes || '', mod:recipe.mod || '', special:false};
    });
    const customItems = saved.customItems.map(item => {
      requireValue(item && itemID(item.id) && text(item.name, 100) && item.name.length > 0 && text(item.english || '', 200), '사용자 아이템 정보가 올바르지 않습니다.');
      const result = {id:item.id, name:item.name, english:item.english || item.name};
      if (item.iconID != null) { requireValue(itemID(item.iconID), '아이콘 ID가 올바르지 않습니다.'); result.iconID = item.iconID; }
      return result;
    });
    requireValue(new Set(custom.map(r => r.id)).size === custom.length && new Set(customItems.map(i => i.id)).size === customItems.length, '같은 ID가 중복된 백업입니다.');
    requireValue(saved.favorites.every(value => text(value, 200)) && saved.materials.every(itemID), '즐겨찾기 또는 재료 목록이 올바르지 않습니다.');
    const customIcons = {};
    requireValue(saved.customIcons == null || (typeof saved.customIcons === 'object' && !Array.isArray(saved.customIcons)), '아이콘 목록이 올바르지 않습니다.');
    for (const [id, image] of Object.entries(saved.customIcons || {})) {
      requireValue(itemID(id) && text(image, 360000) && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image), '아이콘은 PNG, WebP, JPEG 이미지여야 합니다.');
      customIcons[id] = image;
    }
    const normalized = {privateContent:{craftPocket:{
      v:1, revision:Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0,
      sort:['material','name','method','ingredients','output'].includes(saved.sort) ? saved.sort : 'material',
      tab:['all','favorites','custom'].includes(saved.tab) ? saved.tab : 'all',
      query:text(saved.query, 300) ? saved.query : '', kind:text(saved.kind, 80) ? saved.kind : '',
      match:saved.match === 'any' ? 'any' : 'all', materials:[...new Set(saved.materials)], favorites:[...new Set(saved.favorites)],
      custom, customItems, customIcons
    }}};
    requireValue(new TextEncoder().encode(JSON.stringify(normalized)).length <= MAX_BYTES, '저장 용량이 4 MB를 넘었습니다. 큰 아이콘을 줄여주세요.');
    return normalized;
  }
  function mergeSnapshots(current, incoming) {
    const left = current ? validateSnapshot(current).privateContent.craftPocket : defaultState();
    const right = validateSnapshot(incoming).privateContent.craftPocket;
    const mergeByID = (a,b) => [...new Map(a.concat(b).map(value => [value.id,value])).values()];
    return validateSnapshot({privateContent:{craftPocket:{...left, revision:Date.now(),
      custom:mergeByID(left.custom,right.custom), customItems:mergeByID(left.customItems,right.customItems),
      favorites:[...new Set(left.favorites.concat(right.favorites))], customIcons:{...left.customIcons,...right.customIcons}
    }}});
  }
  function createStore(storage, key) {
    let snapshot = null, raw = null, readable = true, error = '', unsaved = false;
    try {
      raw = storage.getItem(key);
      if (raw != null) snapshot = validateSnapshot(JSON.parse(raw));
    } catch (_) { readable = false; error = '저장 데이터를 읽지 못했습니다. 원본 백업 후 복원해 주세요.'; }
    return {
      get snapshot() { return snapshot; }, get error() { return error; }, get unsaved() { return unsaved; },
      get exportText() { return !readable && raw != null ? raw : JSON.stringify({format:'craftpocket-web-backup',version:1,snapshot:snapshot || {privateContent:{craftPocket:defaultState()}}}); },
      write(value, recovering = false) {
        let next;
        try { next = validateSnapshot(value); }
        catch (failure) { error = failure.message; unsaved = true; return false; }
        if (!readable && !recovering) { if (raw == null) snapshot = next; unsaved = true; return false; }
        const serialized = JSON.stringify(next);
        try {
          if (storage.getItem(key) !== raw) {
            snapshot = next; unsaved = true;
            error = '다른 창에서 데이터가 변경되었습니다. 현재 내용을 백업한 뒤 새로고침해 주세요.';
            return false;
          }
          if (!readable && raw != null) storage.setItem(key + ':unreadable-backup', raw);
          storage.setItem(key, serialized);
          raw = serialized; snapshot = next; readable = true; error = ''; unsaved = false; return true;
        } catch (_) {
          snapshot = next; unsaved = true;
          error = '기기에 저장하지 못했습니다. 새로고침 전에 백업 파일을 저장해 주세요.';
          return false;
        }
      }
    };
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = {validateSnapshot, mergeSnapshots, createStore, defaultState, MAX_BYTES, MAX_BACKUP_BYTES, MAX_RECIPES};
    return;
  }

  let storage;
  try { storage = window.localStorage; } catch (_) { storage = {getItem(){throw new Error('Unavailable');},setItem(){throw new Error('Unavailable');}}; }
  const store = createStore(storage, 'craftpocket:pwa:v1:' + new URL('./', document.baseURI).pathname);
  window.CraftPocketPWA = {
    get snapshot() { return store.snapshot; }, maxCustomRecipes:MAX_RECIPES,
    writeSnapshot(value) { const ok = store.write(value); updateStorageStatus(); return ok; }
  };
  function button(label, action) { const result = document.createElement('button'); result.type = 'button'; result.textContent = label; result.addEventListener('click', action); return result; }
  let storageStatus;
  function updateStorageStatus() { if (storageStatus) { storageStatus.textContent = store.error || '즐겨찾기와 내 조합법은 이 기기에 저장됩니다.'; if (store.error) storageStatus.closest('details').open = true; } }
  function downloadBackup() {
    const url = URL.createObjectURL(new Blob([store.exportText], {type:'application/json'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CraftPocket-web-backup-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function setupBackup() {
    const area = document.getElementById('cp-backup-controls');
    if (!area) return;
    const panel = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '내 데이터 · 백업'; panel.append(summary);
    storageStatus = document.createElement('p'); storageStatus.setAttribute('role','status'); panel.append(storageStatus); updateStorageStatus();
    const exportButton = button('백업 파일 저장', downloadBackup);
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
    const importButton = button('백업 가져오기', () => input.click());
    const preview = document.createElement('div'); preview.setAttribute('role','status');
    input.addEventListener('change', async () => {
      preview.replaceChildren(); const file = input.files && input.files[0]; if (!file) return;
      try {
        requireValue(file.size <= MAX_BACKUP_BYTES, '4 MB 이하의 웹앱 백업 파일을 골라주세요.');
        const parsed = JSON.parse(await file.text());
        requireValue(parsed.format === 'craftpocket-web-backup' && parsed.version === 1, '주머니 제작대 웹앱 백업 파일을 골라주세요.');
        const incoming = validateSnapshot(parsed.snapshot), state = incoming.privateContent.craftPocket;
        const message = document.createElement('p'); message.textContent = '조합법 ' + state.custom.length + '개 · 즐겨찾기 ' + state.favorites.length + '개를 합칩니다. 같은 ID의 항목은 백업 내용으로 갱신됩니다.';
        const confirm = button('합쳐서 가져오기', () => {
          try {
            requireValue(!document.querySelector('#cp-editor:not([hidden]),#cp-picker:not([hidden])'), '편집을 저장하거나 취소한 뒤 가져와 주세요.');
            const merged = mergeSnapshots(store.snapshot, incoming);
            requireValue(store.write(merged, true), store.error);
            window.dispatchEvent(new CustomEvent('craftpocket:restore', {detail:merged}));
            preview.textContent = '백업을 가져왔습니다.'; updateStorageStatus();
          } catch (failure) { preview.textContent = failure.message; }
        });
        preview.append(message,confirm,button('취소', () => preview.replaceChildren()));
      } catch (failure) { preview.textContent = failure.message || '백업을 읽지 못했습니다.'; }
      input.value = '';
    });
    panel.append(exportButton,importButton,input,preview); area.append(panel);
    if (store.error) panel.open = true;
  }
  function setupInstall() {
    const status = document.getElementById('cp-install-status'), controls = document.getElementById('cp-install-controls');
    if (!status || !controls) return;
    let ready = false, applyingUpdate = false, registration;
    const help = document.createElement('p'); help.hidden = true; help.textContent = '아이폰 Safari에서 공유 → 홈 화면에 추가를 선택하세요. 홈 화면 아이콘으로 다시 열고, 오프라인 사용 준비 완료를 확인해 주세요.';
    controls.append(button('홈 화면에 추가하는 방법', () => { help.hidden = !help.hidden; }),help);
    function renderStatus() { status.textContent = ready ? (navigator.onLine ? '오프라인 사용 준비 완료' : '오프라인으로 이용 중') : '오프라인 사용 준비 중…'; }
    function checkReady() { const worker = registration && registration.active; if (worker) worker.postMessage({type:'GET_CACHE_STATUS'}); }
    function showUpdate() {
      if (!registration.waiting || !registration.active) { controls.querySelector('[data-update]')?.remove(); return; }
      if (controls.querySelector('[data-update]')) return;
      const update = button('새 버전 적용', () => {
        const waiting = registration.waiting;
        if (!waiting) { update.remove(); checkReady(); return; }
        if (store.unsaved || document.querySelector('#cp-editor:not([hidden]),#cp-picker:not([hidden])')) { status.textContent = '편집 중인 내용을 저장하거나 취소한 뒤 업데이트해 주세요.'; return; }
        applyingUpdate = true; waiting.postMessage({type:'SKIP_WAITING'});
      });
      update.dataset.update = 'true'; controls.append(update);
    }
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { status.textContent = '오프라인 설치는 HTTPS 배포 주소에서 사용할 수 있습니다.'; return; }
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.source && event.source.scriptURL !== new URL('./sw.js', document.baseURI).href) return;
      if (event.data && event.data.type === 'CACHE_STATUS') { ready = event.data.ready === true; renderStatus(); }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (applyingUpdate) location.reload(); else { checkReady(); if (registration) showUpdate(); } });
    window.addEventListener('online', () => { renderStatus(); checkReady(); }); window.addEventListener('offline', renderStatus);
    navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'}).then(reg => {
      registration = reg; checkReady(); showUpdate();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing; if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') { showUpdate(); checkReady(); }
          if (worker.state === 'activated') checkReady();
          if (worker.state === 'redundant' && !ready) status.textContent = '오프라인 저장을 완료하지 못했습니다. 인터넷 연결 후 새로고침해 주세요.';
        });
      });
      navigator.serviceWorker.ready.then(checkReady);
    }).catch(() => { status.textContent = '오프라인 저장을 완료하지 못했습니다. 인터넷 연결 후 새로고침해 주세요.'; });
  }
  document.addEventListener('DOMContentLoaded', () => { setupBackup(); setupInstall(); });
})();
