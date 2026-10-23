(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const fallbackImage = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80';
  let listings = [];
  let favorites = new Set(JSON.parse(localStorage.getItem('tuvaDomFavorites') || '[]'));
  let favoritesOnly = false;
  let activeDetail = null;
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function safeImage(value) {
    if (typeof value !== 'string') return fallbackImage;
    if (value.startsWith('/uploads/')) return value;
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : fallbackImage; }
    catch (_e) { return fallbackImage; }
  }
  function formatPrice(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₽`;
  }
  function formatArea(value, suffix = 'м²') {
    const number = Number(value) || 0;
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(number)} ${suffix}`;
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }
  function updateFavoriteCount() {
    $('#favoritesCount').textContent = favorites.size;
    $('#favoritesFilter').classList.toggle('is-active', favoritesOnly);
    localStorage.setItem('tuvaDomFavorites', JSON.stringify([...favorites]));
  }
  function applyFilters() {
    const minPrice = Number($('#priceMin').value) || 0;
    const maxPrice = Number($('#priceMax').value) || Infinity;
    const minArea = Number($('#areaMin').value) || 0;
    const material = $('#materialFilter').value;
    let result = listings.filter(item => {
      if ((Number(item.price) || 0) < minPrice || (Number(item.price) || 0) > maxPrice) return false;
      if ((Number(item.totalArea) || 0) < minArea) return false;
      if (material && item.material !== material) return false;
      if (favoritesOnly && !favorites.has(item.id)) return false;
      return true;
    });
    const sort = $('#sortSelect').value;
    if (sort === 'priceAsc') result.sort((a,b) => a.price-b.price);
    else if (sort === 'priceDesc') result.sort((a,b) => b.price-a.price);
    else if (sort === 'areaDesc') result.sort((a,b) => b.totalArea-a.totalArea);
    else result.sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    renderCards(result);
  }
  function listingCard(item) {
    const photo = safeImage((item.photos || [])[0]);
    const demo = item.isDemo ? '<span class="listing-tag tag-demo">ПРИМЕР ОФОРМЛЕНИЯ</span>' : '';
    const tag = item.ownerType === 'partner' ? '<span class="listing-tag tag-partner">ОБЪЕКТ ПАРТНЁРА</span>' : '<span class="listing-tag">ОБЪЕКТ ОТ БРИГАДЫ</span>';
    const favorite = favorites.has(item.id);
    return `<article class="listing-card" tabindex="0" role="button" aria-label="Подробнее: ${escapeHtml(item.title)}" data-listing-id="${escapeHtml(item.id)}">
      <div class="listing-photo"><img src="${escapeHtml(photo)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImage}'">${tag}${demo}<button class="favorite-button ${favorite?'is-favorite':''}" type="button" data-favorite-id="${escapeHtml(item.id)}" aria-label="${favorite?'Убрать из избранного':'Добавить в избранное'}">${favorite?'♥':'♡'}</button></div>
      <div class="listing-card-content"><div class="listing-price">${formatPrice(item.price)}</div><h3 class="listing-title">${escapeHtml(item.title)}</h3><div class="listing-address"><span>⌖</span>${escapeHtml(item.address || 'Кызыл, Республика Тыва')}</div>
      <div class="listing-metrics"><div class="metric"><small>Дом</small><strong>${formatArea(item.totalArea)}</strong></div><div class="metric"><small>Участок</small><strong>${formatArea(item.landArea, 'сот.')}</strong></div><div class="metric"><small>Этажей</small><strong>${escapeHtml(item.floors || '—')}</strong></div></div>
      <div class="listing-card-foot"><span class="listing-material">${escapeHtml(item.material || 'Материал не указан')}</span><span class="details-arrow">↗</span></div></div></article>`;
  }
  function renderCards(items) {
    const grid = $('#listingGrid');
    const empty = $('#emptyState');
    $('#searchCount').textContent = `${items.length} ${items.length === 1 ? 'объект' : items.length < 5 ? 'объекта' : 'объектов'}`;
    $('#catalogFootCount').textContent = `${items.length} ${items.length === 1 ? 'объект в каталоге' : items.length < 5 ? 'объекта в каталоге' : 'объектов в каталоге'}`;
    grid.innerHTML = items.map(listingCard).join('');
    grid.classList.toggle('hidden', items.length === 0);
    empty.classList.toggle('hidden', items.length !== 0);
    const hasDemo = items.some(item => item.isDemo);
    $('#demoNote').classList.toggle('hidden', !hasDemo);
  }
  async function loadListings() {
    try {
      const response = await fetch('/api/listings');
      if (!response.ok) throw new Error('Не удалось получить каталог.');
      listings = await response.json();
      applyFilters();
      updateFavoriteCount();
    } catch (error) {
      $('#listingGrid').innerHTML = `<div class="loading-card">Каталог временно недоступен. Обновите страницу или запустите сайт через сервер.</div>`;
      $('#searchCount').textContent = 'Нет соединения';
      console.error(error);
    }
  }
  function openModal(element) {
    element.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }
  function closeModal(element) {
    element.classList.add('hidden');
    if ($$('.modal-backdrop:not(.hidden)').length === 0) document.body.classList.remove('modal-open');
  }
  function communicationIcon(name) {
    const value = String(name || '').toLowerCase();
    if (value.includes('электр')) return 'ϟ';
    if (value.includes('вод') || value.includes('скваж')) return '≈';
    if (value.includes('отоп')) return '♨';
    if (value.includes('канал') || value.includes('септ')) return '⌁';
    if (value.includes('интернет')) return '⌁';
    if (value.includes('газ')) return '◉';
    if (value.includes('дорог') || value.includes('подъезд')) return '↗';
    return '✓';
  }
  function openListing(id) {
    const item = listings.find(listing => listing.id === id);
    if (!item) return;
    activeDetail = item;
    const images = (item.photos || []).filter(Boolean).slice(0, 12);
    const mainImage = safeImage(images[0]);
    const demo = item.isDemo ? '<span class="listing-tag tag-demo">ПРИМЕР ОФОРМЛЕНИЯ</span>' : '';
    const communications = (item.communications || []).length ? item.communications.map(comm => `<div class="comm-item"><span class="comm-icon">${communicationIcon(comm.name)}</span><div><strong>${escapeHtml(comm.name)}</strong><small>${escapeHtml(comm.details || 'Подробности уточняются')}</small></div></div>`).join('') : '<p class="approach-lead">Информация о коммуникациях пока не добавлена.</p>';
    const lon = Number.isFinite(Number(item.lon)) ? Number(item.lon) : 94.4378;
    const lat = Number.isFinite(Number(item.lat)) ? Number(item.lat) : 51.7191;
    const mapUrl = `https://yandex.ru/map-widget/v1/?ll=${encodeURIComponent(`${lon},${lat}`)}&z=14&l=map&pt=${encodeURIComponent(`${lon},${lat},pm2rdm`)}`;
    const searchAddress = encodeURIComponent(item.address || 'Кызыл, Республика Тыва');
    $('#listingModalBody').innerHTML = `
      <div class="detail-hero"><div class="detail-photo-main"><img id="detailMainImage" src="${escapeHtml(mainImage)}" alt="${escapeHtml(item.title)}" onerror="this.onerror=null;this.src='${fallbackImage}'">${demo}</div><div class="detail-hero-info"><div class="detail-kicker">${item.ownerType === 'partner' ? 'ОБЪЕКТ ПАРТНЁРА' : 'ОБЪЕКТ ОТ БРИГАДЫ'} · КЫЗЫЛ</div><h2 id="detailTitle">${escapeHtml(item.title)}</h2><div class="detail-price">${formatPrice(item.price)}</div><div class="detail-address"><span>⌖</span>${escapeHtml(item.address || 'Кызыл, Республика Тыва')}</div><div class="detail-actions"><button class="button button-dark" type="button" data-detail-lead>Записаться на просмотр <span>↗</span></button><button class="outline-button" type="button" data-detail-favorite>${favorites.has(item.id) ? '♥ В избранном' : '♡ В избранное'}</button></div></div></div>
      ${images.length > 1 ? `<div class="detail-body" style="padding-top:18px;padding-bottom:0"><div class="detail-gallery">${images.map((img,index) => `<img class="detail-thumb ${index===0?'active':''}" src="${escapeHtml(safeImage(img))}" alt="Фото ${index+1}" data-thumb-src="${escapeHtml(safeImage(img))}" onerror="this.style.display='none'">`).join('')}</div></div>` : ''}
      <div class="detail-body"><h3>Характеристики объекта</h3><div class="detail-metrics"><div class="detail-metric"><small>Общая площадь</small><strong>${formatArea(item.totalArea)}</strong></div><div class="detail-metric"><small>Площадь участка</small><strong>${formatArea(item.landArea, 'сот.')}</strong></div><div class="detail-metric"><small>Материал дома</small><strong>${escapeHtml(item.material || 'Не указан')}</strong></div><div class="detail-metric"><small>Этажей / год</small><strong>${escapeHtml(item.floors || '—')} / ${escapeHtml(item.year || '—')}</strong></div></div>
      <div class="detail-subsection"><h3>Об объекте</h3><p class="detail-description">${escapeHtml(item.description || 'Описание объекта пока не добавлено.')}</p></div>
      <div class="detail-subsection"><h3>Коммуникации</h3><div class="comms-grid">${communications}</div></div>
      <div class="detail-subsection"><h3>Расположение и окружение</h3><p class="approach-lead" style="margin-bottom:14px">${escapeHtml(item.address || 'Кызыл, Республика Тыва')}. Проверьте точное расположение и подъезд к дому перед просмотром.</p><iframe class="detail-map" title="Карта расположения объекта" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${mapUrl}"></iframe><div class="map-links"><p>Метка на карте зависит от указанных координат объекта.</p><div><a href="https://yandex.ru/maps/?text=${searchAddress}" target="_blank" rel="noopener">Открыть в Яндекс Картах ↗</a> &nbsp; <a href="https://2gis.ru/kyzyl/search/${searchAddress}" target="_blank" rel="noopener">Открыть в 2ГИС ↗</a></div></div></div>
      <div class="detail-subsection" style="display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap"><div><h3 style="margin-bottom:5px">Хотите посмотреть этот дом?</h3><p style="font-size:12px;color:#879087;margin:0">Оставьте номер — заявка поступит сотрудникам.</p></div><button class="button button-primary" type="button" data-detail-lead>Оставить заявку <span>↗</span></button></div></div>`;
    openModal($('#listingModal'));
  }
  function openLead(item = null) {
    $('#leadForm').reset();
    $('#leadMessage').classList.add('hidden');
    $('#leadMessage').classList.remove('error');
    $('#leadObjectId').value = item ? item.id : '';
    $('#leadObjectTitle').value = item ? item.title : '';
    $('#leadTitle').textContent = item ? 'Записаться на просмотр' : 'Связаться с нами';
    $('#leadIntro').textContent = item ? `Оставьте контакт по объекту «${item.title}».` : 'Расскажите немного о том, что вам нужно.';
    openModal($('#leadModal'));
  }

  $('#filterForm').addEventListener('submit', event => { event.preventDefault(); favoritesOnly = false; updateFavoriteCount(); applyFilters(); document.querySelector('#catalog').scrollIntoView({ behavior:'smooth', block:'start' }); });
  $('#resetFilters').addEventListener('click', () => { $('#filterForm').reset(); favoritesOnly = false; updateFavoriteCount(); applyFilters(); });
  $('#emptyReset').addEventListener('click', () => { $('#filterForm').reset(); favoritesOnly = false; updateFavoriteCount(); applyFilters(); });
  $('#sortSelect').addEventListener('change', applyFilters);
  $('#favoritesFilter').addEventListener('click', () => { favoritesOnly = !favoritesOnly; updateFavoriteCount(); applyFilters(); });
  $('#listingGrid').addEventListener('click', event => {
    const favoriteButton = event.target.closest('[data-favorite-id]');
    if (favoriteButton) {
      event.stopPropagation();
      const id = favoriteButton.dataset.favoriteId;
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      updateFavoriteCount(); applyFilters(); return;
    }
    const card = event.target.closest('[data-listing-id]');
    if (card) openListing(card.dataset.listingId);
  });
  $('#listingGrid').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-listing-id]')) { event.preventDefault(); openListing(event.target.dataset.listingId); }
  });
  $('#listingModalBody').addEventListener('click', event => {
    const thumb = event.target.closest('[data-thumb-src]');
    if (thumb) {
      $('#detailMainImage').src = thumb.dataset.thumbSrc;
      $$('.detail-thumb').forEach(img => img.classList.toggle('active', img === thumb));
    }
    if (event.target.closest('[data-detail-lead]') && activeDetail) openLead(activeDetail);
    if (event.target.closest('[data-detail-favorite]') && activeDetail) {
      if (favorites.has(activeDetail.id)) favorites.delete(activeDetail.id); else favorites.add(activeDetail.id);
      updateFavoriteCount();
      event.target.closest('[data-detail-favorite]').textContent = favorites.has(activeDetail.id) ? '♥ В избранном' : '♡ В избранное';
      applyFilters();
    }
  });
  document.addEventListener('click', event => {
    const openLeadButton = event.target.closest('[data-open-lead]');
    if (openLeadButton) { event.preventDefault(); openLead(); }
    const close = event.target.closest('[data-close-modal]');
    if (close) closeModal(close.closest('.modal-backdrop'));
    if (event.target.classList && event.target.classList.contains('modal-backdrop')) closeModal(event.target);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') $$('.modal-backdrop:not(.hidden)').forEach(closeModal);
  });
  $('#leadForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#leadForm button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Отправляем…';
    const formData = new FormData(event.currentTarget);
    const body = Object.fromEntries(formData.entries());
    try {
      const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить заявку.');
      $('#leadMessage').textContent = data.message;
      $('#leadMessage').classList.remove('hidden', 'error');
      event.currentTarget.reset();
      showToast('Заявка отправлена');
    } catch (error) {
      $('#leadMessage').textContent = error.message || 'Не удалось отправить заявку. Проверьте соединение.';
      $('#leadMessage').classList.remove('hidden'); $('#leadMessage').classList.add('error');
    } finally {
      submit.disabled = false; submit.innerHTML = 'Отправить заявку <span>↗</span>';
    }
  });
  $('#mobileMenuButton').addEventListener('click', () => $('#mobileNav').classList.toggle('open'));
  $$('.mobile-nav a').forEach(link => link.addEventListener('click', () => $('#mobileNav').classList.remove('open')));
  $('#currentYear').textContent = new Date().getFullYear();
  loadListings();
})();
