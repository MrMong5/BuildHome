require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });
for (const file of ['listings.json', 'users.json', 'leads.json']) {
  const fullPath = path.join(DATA_DIR, file);
  if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, '[]\n', 'utf8');
}

if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_USERNAME) {
  console.error('\nНе настроен .env. Скопируйте .env.example в .env и задайте SESSION_SECRET, ADMIN_USERNAME и ADMIN_PASSWORD.\n');
  process.exit(1);
}

function readJson(fileName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8'));
  } catch (error) {
    console.error(`Не удалось прочитать ${fileName}:`, error.message);
    return [];
  }
}

function writeJson(fileName, data) {
  const destination = path.join(DATA_DIR, fileName);
  const temp = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, destination);
}

async function ensureInitialAdmin() {
  const users = readJson('users.json');
  if (users.length > 0) return;
  users.push({
    username: process.env.ADMIN_USERNAME.trim(),
    passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
    role: 'admin',
    createdAt: new Date().toISOString()
  });
  writeJson('users.json', users);
  console.log(`Создана первая учётная запись администратора: ${process.env.ADMIN_USERNAME.trim()}`);
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif' };
    callback(null, `${crypto.randomBytes(16).toString('hex')}${extMap[file.mimetype] || '.jpg'}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (!allowed.includes(file.mimetype)) return callback(new Error('Можно загружать изображения JPG, PNG, WEBP или AVIF.'));
    callback(null, true);
  }
});

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  name: 'tuva_dom.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 60 * 1000
  }
}));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте позже.' }
});
const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много заявок. Попробуйте позже.' }
});

function safeUser(user) {
  return { username: user.username, role: user.role };
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Для этого действия нужно войти в панель сотрудников.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(req.session.user ? 403 : 401).json({ error: 'Действие доступно только администратору.' });
  }
  next();
}
function parseJsonField(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || '');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}
function stringValue(value, max = 6000) {
  return String(value ?? '').trim().slice(0, max);
}
function numericValue(value, fallback = 0) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function normaliseListing(body, oldListing, files, user) {
  const currentPhotos = oldListing
    ? parseJsonField(body.currentPhotos, oldListing.photos || [])
    : [];
  const uploadedPhotos = (files || []).map(file => `/uploads/${file.filename}`);
  const communications = parseJsonField(body.communications, []);
    
  return {
    id: oldListing ? oldListing.id : crypto.randomUUID(),
    title: stringValue(body.title, 180),
    price: Math.max(0, Math.round(numericValue(body.price, 0))),
    address: stringValue(body.address, 300),
    district: stringValue(body.district, 120) || 'Кызыл',
    totalArea: Math.max(0, numericValue(body.totalArea, 0)),
    landArea: Math.max(0, numericValue(body.landArea, 0)),
    material: stringValue(body.material, 100),
    floors: Math.max(1, Math.round(numericValue(body.floors, 1))),
    year: Math.max(1800, Math.min(2200, Math.round(numericValue(body.year, new Date().getFullYear())))),
    description: stringValue(body.description, 10000),
    communications: communications.map(item => ({
      name: stringValue(item && item.name, 100),
      details: stringValue(item && item.details, 300)
    })).filter(item => item.name),
    photos: [...new Set([...currentPhotos.filter(p => typeof p === 'string' && p.length < 2000), ...uploadedPhotos])].slice(0, 12),
    lat: Math.max(-90, Math.min(90, numericValue(body.lat, 51.7191))),
    lon: Math.max(-180, Math.min(180, numericValue(body.lon, 94.4378))),
    ownerType: body.ownerType === 'partner' ? 'partner' : 'builder',
    status: body.status === 'draft' ? 'draft' : 'published',
    isDemo: false,
    createdAt: oldListing ? oldListing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: oldListing ? (oldListing.author || user.username) : user.username
  };
}
function removeManagedUploads(photos) {
  for (const item of photos || []) {
    if (typeof item !== 'string' || !item.startsWith('/uploads/')) continue;
    const basename = path.basename(item);
    const fullPath = path.join(UPLOAD_DIR, basename);
    if (fullPath.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (_error) { /* clean-up is best-effort */ }
    }
  }
}
function validateListing(item, res) {
  if (!item.title) return res.status(400).json({ error: 'Укажите название объекта.' });
  if (!item.price || item.price < 1) return res.status(400).json({ error: 'Укажите цену объекта.' });
  if (!item.address) return res.status(400).json({ error: 'Укажите адрес или район расположения объекта.' });
  if (!item.totalArea || item.totalArea <= 0) return res.status(400).json({ error: 'Укажите общую площадь дома.' });
  if (!item.material) return res.status(400).json({ error: 'Укажите материал дома.' });
  return null;
}

app.get('/api/session', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = stringValue(req.body.username, 80);
  const password = String(req.body.password || '');
  const user = readJson('users.json').find(item => item.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Неверный логин или пароль.' });
  }
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Не удалось создать сессию. Попробуйте ещё раз.' });
    req.session.user = safeUser(user);
    res.json({ user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('tuva_dom.sid', { httpOnly: true, sameSite: 'lax' });
    res.json({ ok: true });
  });
});

app.get('/api/listings', (req, res) => {
  let listings = readJson('listings.json');
  if (req.query.manage === '1') {
    if (!req.session.user) return res.status(401).json({ error: 'Войдите в панель сотрудников.' });
    return res.json(listings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }
  listings = listings.filter(item => item.status === 'published');
  res.json(listings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/listings/:id', (req, res) => {
  const item = readJson('listings.json').find(listing => listing.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Объект не найден.' });
  if (item.status !== 'published' && !req.session.user) return res.status(404).json({ error: 'Объект не найден.' });
  res.json(item);
});

app.post('/api/listings', requireAuth, upload.array('photos', 8), (req, res) => {
  const listings = readJson('listings.json');
  const item = normaliseListing(req.body, null, req.files, req.session.user);
  if (validateListing(item, res)) return;
  listings.push(item);
  writeJson('listings.json', listings);
  res.status(201).json({ listing: item });
});

app.put('/api/listings/:id', requireAuth, upload.array('photos', 8), (req, res) => {
  const listings = readJson('listings.json');
  const index = listings.findIndex(item => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Объект не найден.' });
  const oldListing = listings[index];
  const item = normaliseListing(req.body, oldListing, req.files, req.session.user);
  if (validateListing(item, res)) return;
  const photosToRemove = (oldListing.photos || []).filter(photo => !item.photos.includes(photo));
  removeManagedUploads(photosToRemove);
  listings[index] = item;
  writeJson('listings.json', listings);
  res.json({ listing: item });
});

app.patch('/api/listings/:id/status', requireAuth, (req, res) => {
  const listings = readJson('listings.json');
  const item = listings.find(listing => listing.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Объект не найден.' });
  if (!['published', 'draft'].includes(req.body.status)) return res.status(400).json({ error: 'Некорректный статус.' });
  item.status = req.body.status;
  item.updatedAt = new Date().toISOString();
  writeJson('listings.json', listings);
  res.json({ listing: item });
});

app.delete('/api/listings/:id', requireAuth, (req, res) => {
  const listings = readJson('listings.json');
  const item = listings.find(listing => listing.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Объект не найден.' });
  writeJson('listings.json', listings.filter(listing => listing.id !== req.params.id));
  removeManagedUploads(item.photos);
  res.json({ ok: true });
});

app.post('/api/leads', leadLimiter, (req, res) => {
  const name = stringValue(req.body.name, 120);
  const phone = stringValue(req.body.phone, 60);
  const message = stringValue(req.body.message, 2000);
  if (name.length < 2 || phone.length < 5) return res.status(400).json({ error: 'Укажите имя и контактный телефон.' });
  const leads = readJson('leads.json');
  const lead = {
    id: crypto.randomUUID(),
    name,
    phone,
    message,
    objectId: stringValue(req.body.objectId, 100),
    objectTitle: stringValue(req.body.objectTitle, 180),
    createdAt: new Date().toISOString(),
    status: 'new'
  };
  leads.unshift(lead);
  writeJson('leads.json', leads);
  res.status(201).json({ ok: true, message: 'Заявка отправлена. Сотрудник свяжется с вами после обработки.' });
});

app.get('/api/leads', requireAuth, (req, res) => {
  res.json(readJson('leads.json'));
});

app.patch('/api/leads/:id/status', requireAuth, (req, res) => {
  const leads = readJson('leads.json');
  const lead = leads.find(item => item.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Заявка не найдена.' });
  lead.status = req.body.status === 'done' ? 'done' : 'new';
  writeJson('leads.json', leads);
  res.json({ lead });
});

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(readJson('users.json').map(safeUser));
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const username = stringValue(req.body.username, 50);
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    return res.status(400).json({ error: 'Логин должен содержать 3–50 символов: латинские буквы, цифры, точку, дефис или подчёркивание.' });
  }
  if (password.length < 10) return res.status(400).json({ error: 'Пароль должен содержать не менее 10 символов.' });
  const users = readJson('users.json');
  if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Пользователь с таким логином уже существует.' });
  }
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  const user = { username, passwordHash: await bcrypt.hash(password, 12), role, createdAt: new Date().toISOString() };
  users.push(user);
  writeJson('users.json', users);
  res.status(201).json({ user: safeUser(user) });
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const username = decodeURIComponent(req.params.username);
  if (username.toLowerCase() === req.session.user.username.toLowerCase()) {
    return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись.' });
  }
  const users = readJson('users.json');
  const exists = users.some(user => user.username.toLowerCase() === username.toLowerCase());
  if (!exists) return res.status(404).json({ error: 'Пользователь не найден.' });
  writeJson('users.json', users.filter(user => user.username.toLowerCase() !== username.toLowerCase()));
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Один файл не должен превышать 8 МБ.' : 'Не удалось загрузить файлы. Проверьте количество и размер фотографий.';
    return res.status(400).json({ error: message });
  }
  res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера.' });
});

ensureInitialAdmin().then(() => {
  app.listen(PORT, () => {
    console.log(`\nТуваДом запущен: http://localhost:${PORT}`);
    console.log(`Панель сотрудников: http://localhost:${PORT}/admin.html\n`);
    if (process.env.NODE_ENV === 'production') {
      console.warn('Важно: express-session по умолчанию хранит сессии в памяти. Для многопользовательского production-развёртывания подключите постоянное session-хранилище.');
    }
  });
}).catch(error => {
  console.error('Не удалось подготовить администратора:', error);
  process.exit(1);
});
