(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const fallbackImage = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=400&q=75';
  let sessionUser = null;
  let listings = [];
  let leads = [];
  let currentEditId = null;
  let currentPhotos = [];
  let toastTimeout;

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function imageUrl(value) {
    if (typeof value !== 'string') return fallbackImage;
    if (value.startsWith('/uploads/')) return value;
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : fallbackImage; } catch (_e) { return fallbackImage; }
  }
  function money(value) { return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₽`; }
  function showToast(message) {
    const el = $('#adminToast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => el.classList.remove('show'), 3000);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, options);
    let data = {};
    try { data = await response.json(); } catch (_e) { data = {}; }
    if (!response.ok) throw new Error(data.error || `Ошибка запроса (${response.status}).`);
    return data;
  }
  function setSignedIn(user) {
    sessionUser = user;
    $('#loginCard').style.display = user ? 'none' : 'block';
    $('#dashboard').style.display = user ? 'block' : 'none';
    $('#logoutButton').classList.toggle('hidden', !user);
    if (user) {
      $('#welcomeName').textContent = user.username;
      const isAdmin = user.role === 'admin';
      $('#staffTabButton').classList.toggle('hidden', false);
      $('#createStaffCard').classList.toggle('hidden', !isAdmin);
      $('#staffAccessNote').classList.toggle('hidden', isAdmin);
      refreshAll();
      if (isAdmin) loadStaff();
    }
  }
  async function checkSession() {
    try {
      const data = await api('/api/session');
      setSignedIn(data.user);
    } catch (_e) { setSignedIn(null); }
  }
  async function refreshAll() {
    try {
      const [listingData, leadData] = await Promise.all([api('/api/listings?manage=1'), api('/api/leads')]);
      listings = listingData; leads = leadData;
      renderAdminListings(); renderLeads(); renderStats();
      if (sessionUser && sessionUser.role === 'admin') await loadStaff();
    } catch (error) { showToast(error.message); }
  }
  function renderStats() {
    $('#statAll').textContent = listings.length;
    $('#statPublished').textContent = listings.filter(item => item.status === 'published').length;
    const newLeads = leads.filter(item => item.status !== 'done').length;
    $('#statLeads').textContent = newLeads;
    $('#newLeadBadge').textContent = newLeads ? `(${newLeads})` : '';
  }
  function renderAdminListings() {
    if (!listings.length) { $('#adminListings').innerHTML = '<div class="admin-empty">Объявлений пока нет. Добавьте первый объект кнопкой выше.</div>'; return; }
    $('#adminListings').innerHTML = listings.map(item => {
      const isPublished = item.status === 'published';
      const tag = item.isDemo ? '<span class="status-pill draft">демо</span>' : '';
      return `<article class="admin-list-row"><img src="${esc(imageUrl((item.photos||[])[0]))}" alt="" onerror="this.onerror=null;this.src='${fallbackImage}'"><div class="admin-list-meta"><h3>${esc(item.title)} <span class="status-pill ${isPublished?'':'draft'}">${isPublished?'Опубликован':'Черновик'}</span> ${tag}</h3><p>${esc(item.address || 'Адрес не указан')} · ${esc(item.totalArea || '—')} м² · ${esc(item.material || 'Материал не указан')}</p><strong>${money(item.price)}</strong></div><div class="admin-row-actions"><button class="small-action" type="button" data-edit="${esc(item.id)}">Изменить</button><button class="small-action" type="button" data-toggle="${esc(item.id)}">${isPublished?'Снять':'Опубликовать'}</button><button class="small-action danger" type="button" data-delete="${esc(item.id)}">Удалить</button></div></article>`;
    }).join('');
  }
  function renderLeads() {
    if (!leads.length) { $('#adminLeads').innerHTML = '<div class="admin-empty">Заявок пока нет. Новые обращения с сайта появятся здесь.</div>'; return; }
    $('#adminLeads').innerHTML = leads.map(lead => {
      const date = lead.createdAt ? new Date(lead.createdAt).toLocaleString('ru-RU', { dateStyle:'medium', timeStyle:'short' }) : '';
      return `<article class="lead-row ${lead.status==='done'?'is-done':''}"><div><h3>${esc(lead.name)} · <a href="tel:${esc(lead.phone.replace(/[^\d+]/g,''))}">${esc(lead.phone)}</a></h3>${lead.objectTitle?`<p class="lead-object">Объект: ${esc(lead.objectTitle)}</p>`:''}${lead.message?`<p>${esc(lead.message)}</p>`:''}<small>${esc(date)}${lead.status==='done'?' · Обработана':' · Новая заявка'}</small></div><button class="small-action" type="button" data-lead-status="${esc(lead.id)}" data-status="${lead.status==='done'?'new':'done'}">${lead.status==='done'?'Вернуть в новые':'Отметить обработанной'}</button></article>`;
    }).join('');
  }
  async function loadStaff() {
    if (!sessionUser || sessionUser.role !== 'admin') return;
    try {
      const users = await api('/api/users');
      $('#staffTable').innerHTML = users.map(user => `<tr><td><b>${esc(user.username)}</b>${user.username===sessionUser.username?' <small>(вы)</small>':''}</td><td><span class="role-badge ${user.role==='admin'?'admin':''}">${user.role==='admin'?'Администратор':'Сотрудник'}</span></td><td>${user.username===sessionUser.username?'<span style="color:#98a198">—</span>':`<button class="small-action danger" type="button" data-remove-user="${esc(user.username)}">Удалить доступ</button>`}</td></tr>`).join('') || '<tr><td colspan="3">Учётных записей пока нет.</td></tr>';
    } catch (error) { $('#staffTable').innerHTML = `<tr><td colspan="3">${esc(error.message)}</td></tr>`; }
  }
  function selectTab(tabName) {
    $$('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tabName));
    $$('.admin-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tabName}`));
    if (tabName === 'leads') renderLeads();
    if (tabName === 'staff') loadStaff();
  }
  function addCommunicationRow(item = { name:'', details:'' }) {
    const row = document.createElement('div'); row.className = 'comm-edit-row';
    row.innerHTML = `<input class="comm-name" aria-label="Название коммуникации" maxlength="100" placeholder="Например, вода" value="${esc(item.name || '')}"><input class="comm-details" aria-label="Характеристика коммуникации" maxlength="300" placeholder="Например, центральная / скважина" value="${esc(item.details || '')}"><button type="button" aria-label="Удалить коммуникацию">×</button>`;
    $('button', row).addEventListener('click', () => row.remove());
    $('#commsEditor').appendChild(row);
  }
  function currentCommunicationRows() {
    return $$('.comm-edit-row', $('#commsEditor')).map(row => ({ name: $('.comm-name', row).value.trim(), details: $('.comm-details', row).value.trim() })).filter(row => row.name);
  }
  function renderPhotoPreviews() {
    const grid = $('#photoPreviewGrid');
    const existing = currentPhotos.map((url,index) => `<div class="photo-preview"><img src="${esc(imageUrl(url))}" alt="Фото объекта" onerror="this.onerror=null;this.src='${fallbackImage}'"><button type="button" data-remove-current="${index}" aria-label="Удалить фотографию">×</button></div>`).join('');
    const files = [...($('#photoFiles').files || [])].map((file,index) => `<div class="photo-preview"><img src="${URL.createObjectURL(file)}" alt="Новое фото"><button type="button" data-remove-new="${index}" aria-label="Убрать выбранный файл">×</button></div>`).join('');
    grid.innerHTML = existing + files;
    $('#currentPhotos').value = JSON.stringify(currentPhotos);
  }
  function openObjectForm(item = null) {
    currentEditId = item ? item.id : null;
    currentPhotos = item ? [...(item.photos || [])] : [];
    $('#objectForm').reset();
    $('#objectFormError').classList.add('hidden');
    $('#commsEditor').innerHTML = '';
    $('#photoFiles').value = '';
    $('#objectFormTitle').textContent = item ? 'Изменить объект' : 'Добавить объект';
    const form = $('#objectForm');
    const set = (field, value) => { const input = form.elements.namedItem(field); if (input) input.value = value ?? ''; };
    if (item) {
      ['title','status','price','totalArea','landArea','material','floors','year','ownerType','address','district','description','lat','lon'].forEach(field => set(field, item[field]));
      (item.communications || []).forEach(addCommunicationRow);
    } else {
      set('status','published'); set('floors',1); set('year',new Date().getFullYear()); set('ownerType','builder'); set('district','Кызыл'); set('lat','51.7191'); set('lon','94.4378');
      [{name:'Электричество',details:''},{name:'Вода',details:''},{name:'Отопление',details:''},{name:'Канализация',details:''}].forEach(addCommunicationRow);
    }
    if (!$('#commsEditor').children.length) addCommunicationRow();
    renderPhotoPreviews();
    const addressInput = form.elements.namedItem('address');
    const updateMapHelp = () => { $('#mapHelpLink').href = `https://yandex.ru/maps/?text=${encodeURIComponent(addressInput.value || 'Кызыл, Республика Тыва')}`; };
    addressInput.removeEventListener('input', updateMapHelp); addressInput.addEventListener('input', updateMapHelp); updateMapHelp();
    $('#objectFormBackdrop').classList.remove('hidden'); document.body.classList.add('modal-open');
  }
  function closeObjectForm() {
    $('#objectFormBackdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
  }
  async function saveObject(event) {
    event.preventDefault();
    const form = $('#objectForm');
    const submit = $('#saveObjectButton');
    const formData = new FormData(form);
    formData.set('currentPhotos', JSON.stringify(currentPhotos));
    formData.set('communications', JSON.stringify(currentCommunicationRows()));
    $('#objectFormError').classList.add('hidden');
    submit.disabled = true; submit.textContent = 'Сохраняем…';
    try {
      const url = currentEditId ? `/api/listings/${encodeURIComponent(currentEditId)}` : '/api/listings';
      const data = await api(url, { method: currentEditId ? 'PUT':'POST', body: formData });
      if (data.listing) {
        const index = listings.findIndex(item => item.id === data.listing.id);
        if (index >= 0) listings[index] = data.listing; else listings.unshift(data.listing);
      }
      closeObjectForm(); renderAdminListings(); renderStats();
      showToast(currentEditId ? 'Объект обновлён' : 'Объект добавлен');
      await refreshAll();
    } catch (error) {
      $('#objectFormError').textContent = error.message;
      $('#objectFormError').classList.remove('hidden');
    } finally {
      submit.disabled = false; submit.innerHTML = 'Сохранить объект <span>↗</span>';
    }
  }

  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    // currentTarget is only available during the synchronous event dispatch.
    // Keep the form reference before awaiting the server response.
    const form = event.currentTarget;
    const errorEl = $('#loginError'); errorEl.classList.add('hidden');
    const submit = $('button[type="submit"]', form); const oldText = submit.innerHTML;
    submit.disabled = true; submit.textContent = 'Входим…';
    try {
      const data = await api('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset(); setSignedIn(data.user);
    } catch (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
    finally { submit.disabled = false; submit.innerHTML = oldText; }
  });
  $('#logoutButton').addEventListener('click', async () => {
    try { await api('/api/logout', { method:'POST' }); } catch (_e) { /* local screen still resets */ }
    setSignedIn(null); showToast('Вы вышли из панели');
  });
  $('#newListingButton').addEventListener('click', () => openObjectForm());
  $('#refreshButton').addEventListener('click', refreshAll);
  $('#refreshLeadsButton').addEventListener('click', refreshAll);
  $('#closeObjectForm').addEventListener('click', closeObjectForm);
  $('#cancelObjectForm').addEventListener('click', closeObjectForm);
  $('#objectFormBackdrop').addEventListener('click', event => { if (event.target === $('#objectFormBackdrop')) closeObjectForm(); });
  $('#objectForm').addEventListener('submit', saveObject);
  $('#addCommunication').addEventListener('click', () => addCommunicationRow());
  $('#photoFiles').addEventListener('change', () => {
    if ($('#photoFiles').files.length > 8) { showToast('Можно выбрать не более 8 новых фотографий за раз.'); $('#photoFiles').value = ''; }
    renderPhotoPreviews();
  });
  $('#photoPreviewGrid').addEventListener('click', event => {
    const removeCurrent = event.target.closest('[data-remove-current]');
    if (removeCurrent) { currentPhotos.splice(Number(removeCurrent.dataset.removeCurrent), 1); renderPhotoPreviews(); return; }
    const removeNew = event.target.closest('[data-remove-new]');
    if (removeNew) {
      const input = $('#photoFiles'); const files = [...input.files]; files.splice(Number(removeNew.dataset.removeNew), 1);
      const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file)); input.files = transfer.files; renderPhotoPreviews();
    }
  });
  $$('.admin-tab').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
  $('#adminListings').addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit]');
    if (edit) { const item = listings.find(listing => listing.id === edit.dataset.edit); if (item) openObjectForm(item); return; }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const item = listings.find(listing => listing.id === toggle.dataset.toggle); if (!item) return;
      try { await api(`/api/listings/${encodeURIComponent(item.id)}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:item.status==='published'?'draft':'published'}) }); await refreshAll(); showToast(item.status==='published'?'Объект снят с публикации':'Объект опубликован'); } catch (error) { showToast(error.message); }
      return;
    }
    const del = event.target.closest('[data-delete]');
    if (del) {
      const item = listings.find(listing => listing.id === del.dataset.delete); if (!item) return;
      if (!confirm(`Удалить объект «${item.title}»? Действие нельзя отменить.`)) return;
      try { await api(`/api/listings/${encodeURIComponent(item.id)}`, { method:'DELETE' }); await refreshAll(); showToast('Объект удалён'); } catch (error) { showToast(error.message); }
    }
  });
  $('#adminLeads').addEventListener('click', async event => {
    const btn = event.target.closest('[data-lead-status]'); if (!btn) return;
    try { await api(`/api/leads/${encodeURIComponent(btn.dataset.leadStatus)}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:btn.dataset.status}) }); await refreshAll(); showToast('Статус заявки обновлён'); } catch (error) { showToast(error.message); }
  });
  $('#createStaffForm').addEventListener('submit', async event => {
    event.preventDefault();
    // Keep the form reference across await; event.currentTarget becomes null afterwards.
    const form = event.currentTarget;
    const errorEl = $('#staffFormError'); errorEl.classList.add('hidden');
    const submit = $('button[type="submit"]', form);
    const oldText = submit.innerHTML;
    submit.disabled = true; submit.textContent = 'Создаём доступ…';
    try {
      await api('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset(); await loadStaff(); showToast('Учётная запись сотрудника создана');
    } catch (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
    finally { submit.disabled = false; submit.innerHTML = oldText; }
  });
  $('#staffTable').addEventListener('click', async event => {
    const btn = event.target.closest('[data-remove-user]'); if (!btn) return;
    if (!confirm(`Удалить доступ сотрудника «${btn.dataset.removeUser}»?`)) return;
    try { await api(`/api/users/${encodeURIComponent(btn.dataset.removeUser)}`, { method:'DELETE' }); await loadStaff(); showToast('Учётная запись удалена'); } catch (error) { showToast(error.message); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#objectFormBackdrop').classList.contains('hidden')) closeObjectForm(); });
  checkSession();
})();
