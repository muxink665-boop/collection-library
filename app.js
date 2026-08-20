import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===== Supabase 配置：把下面的两处占位符替换成你自己的项目地址和匿名公钥 =====
const SUPABASE_URL = 'https://iwwhgedygojoymcqeeob.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hJuO5F852cxsLDP1nQnI0Q_W9VCB-VD';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const builtInCategories = {
  books: {
    label: '书籍',
    icon: '书',
    className: 'book',
    description: '收集纸张里的宇宙，以及阅读曾抵达过的地方。',
    fields: '书名、作者、书籍类型、收藏介质、出版社、ISBN、版本、出版年份、购入渠道、阅读状态、备注',
    genres: ['科幻', '文学小说', '推理悬疑', '历史', '传记', '艺术设计', '人文社科', '漫画绘本', '诗歌', '其他']
  },
  music: {
    label: '音乐',
    icon: '音',
    className: 'music',
    description: '保存声音，也保存当时听到它的那个瞬间。',
    fields: '专辑名、艺人、收藏介质（CD / 黑胶）、音乐类型、厂牌、发行年份、版本、碟片编号、购入渠道、保存状态、备注',
    genres: ['摇滚', '流行', '爵士', '古典', '电子', '民谣', '嘻哈', '原声带', '世界音乐', '其他']
  },
  movies: {
    label: '电影',
    icon: '影',
    className: 'movie',
    description: '把银幕记忆延伸到日常生活里。',
    fields: '电影名、导演、电影类型、收藏介质、国家 / 地区、上映年份、版本、尺寸或规格、购入渠道、保存状态、备注',
    genres: ['剧情', '爱情', '科幻', '悬疑', '恐怖', '喜剧', '动画', '纪录片', '犯罪', '动作']
  }
};
let customCategoryDefs = {};
const categories = builtInCategories;
function allCategories() { return { ...builtInCategories, ...customCategoryDefs }; }
function getCategory(id) { return builtInCategories[id] || customCategoryDefs[id] || null; }
function isCustomCategory(id) { return !!customCategoryDefs[id]; }
function normalizeCategory(row) {
  return {
    label: row.label,
    icon: row.icon || '藏',
    className: row.className || 'custom',
    description: row.description || '',
    fields: Array.isArray(row.fields) ? row.fields : [],
    genres: Array.isArray(row.genres) ? row.genres : []
  };
}

let entries = [];
let trash = [];
const thirtyDays = 30 * 24 * 60 * 60 * 1000;
let activeCategory = new URLSearchParams(location.search).get('type');
let editingId = null;
let pendingDelete = null;
let choosingCover = false;
let selectedTrash = new Set();
if (!getCategory(activeCategory)) activeCategory = null;
const esc = v => String(v || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
const current = () => getCategory(activeCategory);

// ===== 用户认证：邮箱 + 密码登录，多用户数据隔离 =====
let currentUser = null;
function renderCurrent() {
  const page = document.body.dataset.page;
  if (page === 'home') renderHome();
  else if (page === 'category') renderCategory();
  else if (page === 'trash') renderTrash();
  else renderDetail();
}
function showAuthWall() { const el = document.getElementById('auth-overlay'); if (el) el.hidden = false; }
function hideAuthWall() { const el = document.getElementById('auth-overlay'); if (el) el.hidden = true; }
function renderAuthBar() {
  const bar = document.getElementById('auth-bar'); if (!bar) return;
  if (currentUser) {
    const meta = currentUser.user_metadata || {};
    const name = esc(meta.username || currentUser.email.split('@')[0] || currentUser.email);
    const avatar = meta.avatar_url
      ? '<img src="' + esc(meta.avatar_url) + '" alt="">'
      : esc((meta.username || currentUser.email).slice(0, 1).toUpperCase());
    bar.innerHTML = '<span class="auth-user"><span class="auth-avatar">' + avatar + '</span><span class="auth-user-name" title="' + esc(currentUser.email) + '">' + name + '</span></span><button class="auth-btn" data-logout>登出</button>';
  } else {
    bar.innerHTML = '<button class="auth-btn primary" data-login>登录 / 注册</button>';
  }
}
function renderTopNav() {
  const menu = document.getElementById('top-nav-menu'); if (!menu) return;
  const cats = allCategories();
  const currentType = new URLSearchParams(location.search).get('type');
  menu.innerHTML = Object.entries(cats).map(([id, c]) => `<a class="${id === currentType ? 'active' : ''}" href="category.html?type=${id}">${esc(c.label)}</a>`).join('');
}
function openAuthDialog(mode) {
  const f = document.getElementById('auth-form');
  f.dataset.mode = mode;
  document.querySelector('#auth-title').textContent = mode === 'signup' ? '注册新账户' : '欢迎回来';
  document.querySelector('#auth-toggle-text').textContent = mode === 'signup' ? '已有账户？' : '没有账户？';
  document.querySelector('#auth-toggle').textContent = mode === 'signup' ? '登录' : '注册';
  f.querySelector('button[type=submit]').textContent = mode === 'signup' ? '注册' : '登录';
  document.querySelector('#auth-msg').textContent = '';
  document.querySelectorAll('.signup-only').forEach(el => el.classList.toggle('hidden', mode !== 'signup'));
  document.getElementById('auth-dialog').showModal();
}
async function handleAuth(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const email = f.authEmail.value.trim();
  const password = f.authPassword.value;
  const username = f.authUsername?.value.trim() || '';
  const avatarFile = f.authAvatar?.files[0] || null;
  const msg = document.querySelector('#auth-msg');
  msg.textContent = '处理中…';
  try {
    let avatar_url = '';
    if (avatarFile) avatar_url = await shrinkAvatar(avatarFile);
    const userData = { username, avatar_url };
    const res = f.dataset.mode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname.replace(/[^\/]*$/, ''), data: userData } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (res.error) throw res.error;
    if (f.dataset.mode === 'signup') {
      if (!res.data.session) { msg.textContent = '注册成功，请验证邮箱后登录。'; return; }
      if (username || avatar_url) {
        const { error: updErr } = await supabase.auth.updateUser({ data: userData });
        if (updErr) console.warn('更新用户资料失败', updErr);
      }
    }
    msg.textContent = '';
    document.getElementById('auth-dialog').close();
  } catch (err) { msg.textContent = '出错：' + err.message; }
}
async function logout() { await supabase.auth.signOut(); }
function buildAuthUI() {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-overlay" hidden>
      <div class="welcome-card">
        <div class="welcome-logo">藏 <span>ARCHIVE</span></div>
        <h1 class="welcome-headline">把热爱，<em>一一归档。</em></h1>
        <p class="welcome-lead">为书籍、音乐与电影收藏而生。<br>记录版本、来源、心情，以及每件藏品背后的故事。</p>
        <div class="welcome-features">
          <div><strong>云端同步</strong><span>换设备也不丢</span></div>
          <div><strong>私密空间</strong><span>仅自己可见</span></div>
          <div><strong>永久存档</strong><span>为热爱留底</span></div>
        </div>
        <button class="welcome-cta primary" data-login>登录 / 注册</button>
        <p class="welcome-hint">无需付费 · 邮箱一键开始</p>
      </div>
    </div>
    <dialog id="auth-dialog">
      <form id="auth-form" data-mode="login" novalidate>
        <div class="dialog-head"><div><p class="eyebrow">ACCOUNT</p><h2 id="auth-title">欢迎回来</h2></div><button type="button" class="close" data-auth-close>×</button></div>
        <div class="auth-body">
          <label>邮箱<input name="authEmail" type="email" required placeholder="you@example.com"></label>
          <label>密码<input name="authPassword" type="password" required minlength="6" placeholder="至少 6 位"></label>
          <label class="signup-only hidden">用户名<input name="authUsername" type="text" placeholder="怎么称呼你（选填）"></label>
          <label class="signup-only hidden auth-avatar-row">头像<span>选择一张小图作为头像</span>
            <input name="authAvatar" type="file" accept="image/jpeg,image/png,image/webp">
            <span class="auth-avatar-preview">上传后预览</span>
          </label>
          <p id="auth-msg" class="auth-msg"></p>
          <button class="primary auth-submit" type="submit">登录</button>
          <p class="auth-toggle-line"><span id="auth-toggle-text">没有账户？</span><button type="button" class="text-btn" id="auth-toggle">注册</button></p>
        </div>
      </form>
    </dialog>`);
  const topbar = document.querySelector('.topbar');
  const addBtn = topbar?.querySelector('.add-button');
  if (topbar) {
    if (addBtn) addBtn.insertAdjacentHTML('beforebegin', '<div id="auth-bar"></div>');
    else topbar.insertAdjacentHTML('beforeend', '<div id="auth-bar"></div>');
  }
  document.getElementById('auth-bar').addEventListener('click', async e => {
    if (e.target.closest('[data-login]')) openAuthDialog('login');
    if (e.target.closest('[data-logout]')) { await logout(); }
  });
  document.getElementById('auth-overlay').addEventListener('click', e => {
    if (e.target.closest('[data-login]')) openAuthDialog('login');
  });
  document.getElementById('auth-dialog').addEventListener('click', e => {
    if (e.target.closest('[data-auth-close]')) document.getElementById('auth-dialog').close();
  });
  document.getElementById('auth-toggle').addEventListener('click', () => {
    openAuthDialog(document.getElementById('auth-form').dataset.mode !== 'signup' ? 'signup' : 'login');
  });
  document.getElementById('auth-form').addEventListener('submit', handleAuth);
  const avatarInput = document.querySelector('[name="authAvatar"]');
  const avatarPreview = document.querySelector('.auth-avatar-preview');
  if (avatarInput && avatarPreview) {
    avatarInput.addEventListener('change', () => {
      const file = avatarInput.files[0];
      if (!file) { avatarPreview.innerHTML = ''; avatarPreview.textContent = '上传后预览'; return; }
      const url = URL.createObjectURL(file);
      avatarPreview.innerHTML = '<img src="' + url + '" alt="头像预览">';
    });
  }
}
async function initAuth() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  if (/[?&#](code=|access_token=|token=)/.test(location.search + location.hash)) history.replaceState(null, '', location.pathname);
  renderAuthBar();
  if (currentUser) { hideAuthWall(); try { await supabase.rpc('claim_orphans'); } catch (e) { } }
  else showAuthWall();
  document.documentElement.classList.remove('auth-loading');
  supabase.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    renderAuthBar();
    if (currentUser) {
      hideAuthWall();
      (async () => { try { await supabase.rpc('claim_orphans'); } catch (e) { } await loadCategories(); renderTopNav(); renderTypeOptions(); const { entries: e, trash: t, migrated } = await loadData(); entries = e; trash = t; if (migrated) await persist(); renderCurrent(); })();
    } else { showAuthWall(); entries = []; trash = []; renderCurrent(); }
    document.documentElement.classList.remove('auth-loading');
  });
}

// ===== 自定义品类 =====
async function loadCategories() {
  if (!currentUser) { customCategoryDefs = {}; return; }
  try {
    const { data, error } = await supabase.from('custom_categories').select('*').eq('user_id', currentUser.id);
    if (error) throw error;
    customCategoryDefs = {};
    (data || []).forEach(r => { customCategoryDefs[r.id] = normalizeCategory(r); });
  } catch (err) { console.error('加载自定义品类失败：', err); customCategoryDefs = {}; }
}
async function saveCategory(def) {
  if (!currentUser) return { error: new Error('请先登录') };
  const row = { ...def, user_id: currentUser.id };
  const { data, error } = await supabase.from('custom_categories').upsert(row, { onConflict: 'id' }).select().single();
  if (error) return { error };
  customCategoryDefs[data.id] = normalizeCategory(data);
  renderTopNav();
  return { data };
}
function addCategoryField() {
  const list = document.querySelector('#category-field-list');
  const idx = list.children.length;
  list.insertAdjacentHTML('beforeend', `<div class="category-field-row"><input name="fieldLabel" placeholder="字段名称，如：型号" required><select name="fieldType"><option value="text">文本</option><option value="select">下拉选项</option></select><input name="fieldOptions" placeholder="下拉选项，用逗号分隔"><button type="button" class="secondary" data-remove-field>删除</button></div>`);
}

// ===== 数据持久化：从 Supabase 读取 / 写入 / 删除 =====
async function loadData() {
  try {
    const { data, error } = await supabase.from('entries').select('*').eq('user_id', currentUser ? currentUser.id : null).order('created_at', { ascending: true });
    if (error) throw error;
    const now = Date.now();
    const rows = (data || []).map(r => {
      const n = { ...r };
      if (!n.metadata) n.metadata = {};
      if (!n.category) n.category = n.itemType ? 'movies' : n.format ? 'music' : 'books';
      if (!n.id) n.id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return n;
    });
    let migrated = false;
    rows.forEach(n => { if (n.category === 'movies' && n.itemType && !n.format) { n.format = n.itemType; delete n.itemType; migrated = true; } });
    return {
      entries: rows.filter(r => !r.deletedAt),
      trash: rows.filter(r => r.deletedAt && now - r.deletedAt < thirtyDays),
      migrated
    };
  } catch (err) { console.error('加载数据失败：', err); return { entries: [], trash: [] }; }
}
async function persist() {
  const rows = [...entries, ...trash];
  if (!rows.length) return null;
  const { error } = await supabase.from('entries').upsert(rows, { onConflict: 'id' });
  if (error) console.error('保存失败：', error);
  return error;
}
async function deleteRow(id) { await supabase.from('entries').delete().eq('id', id); }

function card(e) {
  const c = getCategory(e.category);
  if (!c) return '';
  const detail = [e.genre, e.category === 'music' ? null : e.format].filter(Boolean).map(esc).join(' · ');
  const format = e.category === 'music' && e.format ? ` · <strong class="medium">${esc(e.format)}</strong>` : '';
  return `<a class="card-link" href="detail.html?id=${encodeURIComponent(e.id)}"><article class="card text-card"><div class="card-top"><span class="card-mark ${c.className}">${c.icon}</span><span class="card-type">${c.label.toUpperCase()}${detail ? ' · ' + detail : ''}${format}</span></div><h3>${esc(e.title)}</h3><p class="card-meta">${esc(e.creator || '未记录')} <span>·</span> ${esc(e.year || '年份未记录')}</p><p class="card-note">${esc(e.note || '暂无备注')}</p><span class="card-open">查看详情 →</span></article></a>`;
}
function renderHome() {
  const cats = allCategories();
  document.querySelector('#hero-count').textContent = entries.length;
  document.querySelector('#summary-grid').innerHTML = Object.entries(cats).map(([id, c]) => `<a class="summary-item" href="category.html?type=${id}"><span class="summary-count">${entries.filter(e => e.category === id).length}</span><span class="summary-label">${c.label} <i>→</i></span><span class="summary-open">查看更多 →</span></a>`).join('');
  document.querySelector('#shelf-nav').innerHTML = Object.entries(cats).map(([id, c]) => `<a class="shelf" href="category.html?type=${id}">${c.label}</a>`).join('') + '<button class="shelf shelf-new" data-new-category>＋ 新建</button>';
  document.querySelector('#collection-grid').innerHTML = entries.map(card).join('');
  renderTypeOptions();
}
function renderCategory() {
  const c = current();
  if (!c) { document.querySelector('main').innerHTML = '<section class="detail-empty"><h1>没有这个收藏品类</h1><a class="text-link" href="index.html">返回首页</a></section>'; return; }
  document.title = `藏 · ${c.label}收藏`;
  document.querySelector('#category-title').textContent = c.label;
  document.querySelector('#category-description').textContent = c.description;
  const hint = isCustomCategory(activeCategory) ? (c.fields.map(f => f.label).join('、') || '暂无预设字段') : c.fields;
  document.querySelector('#field-hint').innerHTML = '<b>建议记录：</b>' + esc(hint);
  document.querySelector('#list-title').textContent = `我的${c.label}`;
  document.querySelector('#collection-grid').innerHTML = entries.filter(e => e.category === activeCategory).map(card).join('') || '<p class="empty">还没有记录。点击右上角“新增藏品”开始归档。</p>';
  renderTopNav();
}
function renderDetail() {
  const entry = entries.find(e => e.id === new URLSearchParams(location.search).get('id'));
  if (!entry) { document.querySelector('main').innerHTML = '<section class="detail-empty"><h1>没有找到这件藏品</h1><a class="text-link" href="index.html">返回首页</a></section>'; return; }
  const c = getCategory(entry.category);
  if (!c) { document.querySelector('main').innerHTML = '<section class="detail-empty"><h1>没有找到这件藏品</h1><a class="text-link" href="index.html">返回首页</a></section>'; return; }
  let meta;
  if (isCustomCategory(entry.category)) {
    const def = c;
    meta = (def.fields || []).slice(1).map(f => [f.label, (entry.metadata || {})[f.key]]).filter(([, v]) => v);
  } else {
    meta = [['年份', entry.year], ['类型', entry.genre], ['购入渠道', entry.source], ['保存状态', entry.condition]].filter(([, v]) => v);
  }
  const visual = entry.cover ? `<img src="${entry.cover}" alt="${esc(entry.title)} 封面">` : c.icon;
  document.title = `藏 · ${entry.title}`;
  const detailBack = document.querySelector('#detail-back');
  if (detailBack) { detailBack.href = `category.html?type=${entry.category}`; detailBack.textContent = `← 返回${c.label}收藏`; }
  document.querySelector('#detail-content').innerHTML = `<section class="detail-hero"><div class="detail-visual ${c.className}${entry.cover ? ' has-cover' : ''}">${visual}</div><div><p class="eyebrow">${c.label.toUpperCase()} COLLECTION</p><h1>${esc(entry.title)}</h1><p class="detail-creator">${esc(entry.creator || '创作者未记录')}</p>${entry.format ? `<p class="detail-format">${esc(entry.format)}</p>` : ''}<div class="detail-actions"><button class="secondary" data-edit-entry="${entry.id}">编辑资料</button><button class="danger" data-delete-entry="${entry.id}">移入回收站</button></div></div></section><section class="detail-section-heading"><p class="eyebrow">COLLECTION DETAILS</p><h2>藏品信息</h2></section><section class="detail-bento"><div class="bento-card bento-feature"><div class="bento-head"><span class="bento-tag">${esc(c.label)}</span><span class="bento-head-label">名称</span></div><span class="bento-value">${esc(entry.title)}</span><span class="bento-sub">${esc(entry.creator || '创作者未记录')}</span></div><div class="bento-card bento-category"><span class="bento-label">收藏介质</span><span class="bento-value">${esc(entry.format || '—')}</span></div>${meta.map(([k, v]) => `<div class="bento-card bento-meta"><span class="bento-label">${k}</span><span class="bento-value">${esc(v)}</span></div>`).join('')}<div class="bento-card bento-note"><span class="bento-label">PERSONAL NOTE / 收藏笔记</span><p>${esc(entry.note || '尚未记录备注。')}</p></div></section>`;
}
function renderTrash() {
  const grid = document.querySelector('#trash-grid');
  let toolbar = document.querySelector('#trash-toolbar');
  if (!toolbar) { grid.insertAdjacentHTML('beforebegin', '<div id="trash-toolbar" class="trash-toolbar"></div>'); toolbar = document.querySelector('#trash-toolbar'); }
  const selectedCount = selectedTrash.size;
  toolbar.innerHTML = trash.length ? `<label class="select-all"><input type="checkbox" data-select-all ${selectedCount === trash.length ? 'checked' : ''}> 全选</label><span>已选择 ${selectedCount} 项</span><button class="danger" data-permanent-selected ${selectedCount ? '' : 'disabled'}>永久删除所选</button>` : '';
  grid.innerHTML = trash.map(entry => {
    const c = getCategory(entry.category);
    const days = Math.max(0, Math.ceil((thirtyDays - (Date.now() - entry.deletedAt)) / 86400000));
    return `<article class="trash-card text-card"><div class="trash-check"><input type="checkbox" data-trash-check="${entry.id}" ${selectedTrash.has(entry.id) ? 'checked' : ''}></div><div class="card-top"><span class="card-mark ${c.className}">${c.icon}</span><span class="card-type">${c.label}</span></div><h3>${esc(entry.title)}</h3><p class="card-meta">${days} 天后自动永久删除</p><div class="trash-actions"><button class="secondary" data-restore="${entry.id}">恢复</button><button class="danger" data-permanent="${entry.id}">永久删除</button></div></article>`;
  }).join('') || '<p class="empty">回收站为空。</p>';
}
function renderTypeOptions() {
  const cats = allCategories();
  const container = document.querySelector('#type-dialog .type-options');
  if (container) {
    container.innerHTML = Object.entries(cats).map(([id, c]) => `<button data-pick="${id}"><span class="type-icon ${c.className}">${c.icon}</span><b>${c.label}</b><small>${c.description}</small><i>→</i></button>`).join('');
  }
}
function buildDialogs() {
  document.body.insertAdjacentHTML('beforeend', `<dialog id="type-dialog"><div class="dialog-head"><div><p class="eyebrow">NEW ENTRY</p><h2>选择收藏类别</h2></div><button class="close" data-close-type>×</button></div><div class="type-options"></div></dialog><dialog id="entry-dialog"><form id="entry-form" novalidate><div class="dialog-head"><div><p class="eyebrow">NEW ENTRY</p><h2 id="form-title">新增藏品</h2></div><button type="button" class="close" data-dismiss>×</button></div><div class="form-grid" id="form-fields"></div><div class="dialog-actions"><button type="button" class="secondary" data-dismiss>取消</button><button class="primary" type="submit">保存记录</button></div></form></dialog><dialog id="confirm-dialog"><div class="confirm"><p class="eyebrow">UNSAVED CHANGES</p><h2>要保留填写内容吗？</h2><p>你已经填写了部分内容。保留后可继续编辑；不保留则会清空本次填写。</p><div class="dialog-actions"><button class="secondary" data-discard>不保留</button><button class="primary" data-keep>继续填写</button></div></div></dialog><dialog id="delete-dialog"><div class="confirm"><p class="eyebrow">MOVE TO RECYCLE BIN</p><h2 id="delete-title">移入回收站？</h2><p id="delete-message">此收藏会在回收站保留 30 天，期间可随时恢复。</p><div class="dialog-actions"><button class="secondary" data-close-delete>取消</button><button class="danger" data-confirm-delete>确认移入</button></div></div></dialog>`);
}
function buildCategoryDialog() {
  document.body.insertAdjacentHTML('beforeend', `<dialog id="category-dialog"><form id="category-form" novalidate><div class="dialog-head"><div><p class="eyebrow">NEW CATEGORY</p><h2>新建收藏品类</h2></div><button type="button" class="close" data-close-category>×</button></div><div class="form-grid"><label>品类名称<input name="catLabel" required placeholder="例如：黑胶、球鞋、手办"></label><label>图标（单字或 emoji）<input name="catIcon" maxlength="4" placeholder="例如：💿"></label><label class="wide">描述<textarea name="catDescription" rows="2" placeholder="一句话说明这个品类记录什么"></textarea></label><div class="wide category-fields"><p class="fields-heading">字段定义 <span>第一个字段会作为藏品名称</span></p><div id="category-field-list"></div><button type="button" class="secondary" data-add-field>＋ 添加字段</button></div></div><div class="dialog-actions"><button type="button" class="secondary" data-close-category>取消</button><button class="primary" type="submit">保存品类</button></div></form></dialog>`);
}
async function shrinkImage(file) {
  const url = URL.createObjectURL(file), img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  const max = 1200, scale = Math.min(1, max / Math.max(img.width, img.height)), canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  return canvas.toDataURL('image/jpeg', .84);
}
async function shrinkAvatar(file) {
  const url = URL.createObjectURL(file), img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  const max = 128, scale = Math.min(1, max / Math.max(img.width, img.height)), canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  return canvas.toDataURL('image/jpeg', .72);
}
function openForm(category, entry = null) {
  activeCategory = category;
  editingId = entry?.id || null;
  const c = current();
  const select = (name, label, items) => `<label>${label}<select name="${name}"><option value="">请选择</option>${items.map(v => `<option>${v}</option>`).join('')}</select></label>`;
  let fields = `<label class="wide cover-upload">封面图片 <span>支持 JPG、PNG、WebP；将自动压缩并以固定比例展示</span><input name="coverFile" type="file" accept="image/jpeg,image/png,image/webp"><input name="cover" type="hidden"><div class="cover-preview">${entry?.cover ? `<img src="${entry.cover}" alt="当前封面">` : '上传后在此预览'}</div></label>`;
  if (isCustomCategory(category)) {
    const def = c;
    (def.fields || []).forEach((f, idx) => {
      const name = `metadata__${f.key}`;
      if (f.type === 'select') {
        fields += select(name, f.label, f.options || []);
      } else {
        fields += `<label>${f.label}<input name="${name}" placeholder="请输入${f.label}" ${idx === 0 ? 'required' : ''}></label>`;
      }
    });
  } else {
    fields += `<label>名称 / 标题<input name="title" placeholder="${category === 'books' ? '例如：海边的卡夫卡' : category === 'music' ? '例如：In Rainbows' : '例如：花样年华'}" required></label>`;
    fields += `<label>创作者<input name="creator" placeholder="${category === 'books' ? '作者' : '导演、艺人'}"></label>`;
    fields += select('genre', category === 'books' ? '书籍类型' : category === 'music' ? '音乐类型' : '电影类型', c.genres);
    if (category === 'music') fields += select('format', '收藏介质', ['CD', '黑胶']);
    if (category === 'movies') fields += select('format', '收藏介质', ['海报', '明信片', '票根', '剧照', '节目册', '徽章', '模型', '其他']);
    if (category === 'books') fields += select('format', '收藏介质', ['纸质书', '电子书', '其他']);
    fields += `<label>年份<input name="year" type="number" min="1800" max="2100" placeholder="出版 / 发行 / 上映年份"></label>`;
    fields += `<label>购入渠道<input name="source" placeholder="书店、唱片行、二手平台…"></label>`;
    fields += `<label>保存状态<select name="condition"><option>全新</option><option>近全新</option><option>良好</option><option>有使用痕迹</option></select></label>`;
    fields += `<label class="wide">备注<textarea name="note" rows="3" placeholder="版本、签名、购入日期，或你想记住的故事…"></textarea></label>`;
  }
  document.querySelector('#form-title').textContent = `${entry ? '编辑' : '新增'}${c.label}收藏`;
  document.querySelector('#form-fields').innerHTML = fields;
  if (entry) {
    Object.entries(entry).forEach(([key, value]) => {
      const input = document.querySelector(`[name="${key}"]`);
      if (input && key !== 'coverFile') input.value = value || '';
    });
    if (entry.metadata) {
      Object.entries(entry.metadata).forEach(([key, value]) => {
        const input = document.querySelector(`[name="metadata__${key}"]`);
        if (input) input.value = value || '';
      });
    }
  }
  const picker = document.querySelector('[name="coverFile"]');
  picker.addEventListener('click', () => { choosingCover = true; });
  picker.addEventListener('change', async event => {
    choosingCover = false;
    const file = event.target.files[0];
    if (!file) return;
    const preview = document.querySelector('.cover-preview');
    preview.textContent = '正在处理封面…';
    try { const cover = await shrinkImage(file); document.querySelector('[name="cover"]').value = cover; preview.innerHTML = `<img src="${cover}" alt="封面预览">`; } catch { preview.textContent = '图片处理失败，请选择其他图片。'; }
  });
  document.querySelector('#entry-dialog').showModal();
}
const originalOpenForm = openForm;
openForm = function (category, entry = null) {
  originalOpenForm(category, entry);
  const preview = document.querySelector('.cover-preview'), hidden = document.querySelector('[name="cover"]'), picker = document.querySelector('[name="coverFile"]');
  preview.insertAdjacentHTML('afterend', `<button type="button" class="remove-cover" ${entry?.cover ? '' : 'hidden'}>移除封面</button>`);
  const remove = document.querySelector('.remove-cover');
  picker.addEventListener('change', () => { if (picker.files[0]) remove.hidden = false; });
  remove.addEventListener('click', () => { hidden.value = ''; picker.value = ''; preview.textContent = '上传后在此预览'; remove.hidden = true; });
};
function dirty() { return [...document.querySelector('#entry-form').elements].some(el => el.name && el.value && !(el.name === 'condition' && el.value === '全新')); }
function dismiss() { if (!dirty()) return closeEntry(true); document.querySelector('#confirm-dialog').showModal(); }
function closeEntry(reset) { document.querySelector('#confirm-dialog').close(); document.querySelector('#entry-dialog').close(); if (reset) document.querySelector('#entry-form').reset(); }

buildDialogs();
buildCategoryDialog();
buildAuthUI();
document.querySelector('#entry-dialog').addEventListener('cancel', e => { if (choosingCover) { e.preventDefault(); choosingCover = false; return; } e.preventDefault(); dismiss(); });
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => document.body.dataset.page === 'category' ? openForm(activeCategory) : document.querySelector('#type-dialog').showModal()));
document.addEventListener('click', async e => {
  const pick = e.target.closest('[data-pick]');
  if (pick) { document.querySelector('#type-dialog').close(); openForm(pick.dataset.pick); }
  if (e.target.closest('[data-close-type]')) document.querySelector('#type-dialog').close();
  if (e.target.closest('[data-dismiss]')) dismiss();
  if (e.target.closest('[data-discard]')) closeEntry(true);
  if (e.target.closest('[data-keep]')) document.querySelector('#confirm-dialog').close();
  const edit = e.target.closest('[data-edit-entry]');
  if (edit) { const entry = entries.find(item => item.id === edit.dataset.editEntry); if (entry) openForm(entry.category, entry); }
  const move = e.target.closest('[data-delete-entry]');
  if (move) { pendingDelete = { id: move.dataset.deleteEntry, permanent: false }; document.querySelector('#delete-title').textContent = '移入回收站？'; document.querySelector('#delete-message').textContent = '此收藏会在回收站保留 30 天，期间可随时恢复。'; document.querySelector('[data-confirm-delete]').textContent = '确认移入'; document.querySelector('#delete-dialog').showModal(); }
  const permanent = e.target.closest('[data-permanent]');
  if (permanent) { pendingDelete = { id: permanent.dataset.permanent, permanent: true }; document.querySelector('#delete-title').textContent = '永久删除这件藏品？'; document.querySelector('#delete-message').textContent = '永久删除后将无法恢复。'; document.querySelector('[data-confirm-delete]').textContent = '永久删除'; document.querySelector('#delete-dialog').showModal(); }
  const restore = e.target.closest('[data-restore]');
  if (restore) { const item = trash.find(entry => entry.id === restore.dataset.restore); if (item) { trash = trash.filter(entry => entry.id !== item.id); delete item.deletedAt; entries.unshift(item); await persist(); renderTrash(); } }
  if (e.target.closest('[data-close-delete]')) document.querySelector('#delete-dialog').close();
  if (e.target.closest('[data-confirm-delete]') && pendingDelete) {
    if (pendingDelete.permanent) { await deleteRow(pendingDelete.id); trash = trash.filter(item => item.id !== pendingDelete.id); document.querySelector('#delete-dialog').close(); renderTrash(); }
    else { const item = entries.find(entry => entry.id === pendingDelete.id); if (item) { const returnCategory = item.category; entries = entries.filter(entry => entry.id !== item.id); trash.unshift({ ...item, deletedAt: Date.now() }); await persist(); document.querySelector('#delete-dialog').close(); location.href = `category.html?type=${returnCategory}`; } }
  }
  if (e.target.closest('[data-new-category]')) { const list = document.querySelector('#category-field-list'); list.innerHTML = ''; addCategoryField(); document.querySelector('#category-dialog').showModal(); }
  if (e.target.closest('[data-add-field]')) addCategoryField();
  const removeField = e.target.closest('[data-remove-field]');
  if (removeField) removeField.closest('.category-field-row').remove();
  if (e.target.closest('[data-close-category]')) document.querySelector('#category-dialog').close();
});
document.querySelector('#entry-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  const rawForm = { ...Object.fromEntries(new FormData(f)) };
  delete rawForm.coverFile;
  const metadata = {};
  Object.keys(rawForm).forEach(key => {
    if (key.startsWith('metadata__')) { metadata[key.slice('metadata__'.length)] = rawForm[key]; delete rawForm[key]; }
  });
  let title = rawForm.title || '', creator = rawForm.creator || '';
  if (isCustomCategory(activeCategory) && Object.keys(metadata).length) {
    const def = current();
    const firstKey = def.fields[0]?.key;
    if (firstKey) title = metadata[firstKey] || '';
    const secondKey = def.fields[1]?.key;
    if (secondKey) creator = metadata[secondKey] || '';
  }
  const item = { ...rawForm, title, creator, metadata, category: activeCategory, id: editingId || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, user_id: currentUser ? currentUser.id : null };
  if (editingId) entries = entries.map(entry => entry.id === editingId ? item : entry);
  else entries.unshift(item);
  const saveErr = await persist();
  if (saveErr) { alert('保存失败：' + saveErr.message + '。\n请确认已在 Supabase 的 SQL Editor 里运行过 supabase-setup.sql 建好 entries 表。'); return; }
  closeEntry(true);
  if (editingId) { editingId = null; renderDetail(); }
  else if (document.body.dataset.page === 'category') renderCategory();
  else renderHome();
});
document.querySelector('#category-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  const formData = new FormData(f);
  const fields = [];
  document.querySelectorAll('#category-field-list .category-field-row').forEach(row => {
    const label = row.querySelector('[name="fieldLabel"]').value.trim();
    const type = row.querySelector('[name="fieldType"]').value;
    const options = row.querySelector('[name="fieldOptions"]').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (label) fields.push({ key: `field-${fields.length}`, label, type, options });
  });
  if (fields.length === 0) { alert('请至少添加一个字段'); return; }
  const id = `custom-${Date.now()}`;
  const def = { id, label: formData.get('catLabel').trim(), icon: (formData.get('catIcon') || '').trim() || '藏', className: 'custom', description: (formData.get('catDescription') || '').trim(), fields };
  const { error } = await saveCategory(def);
  if (error) { alert('保存品类失败：' + error.message); return; }
  document.querySelector('#category-dialog').close();
  f.reset();
  document.querySelector('#category-field-list').innerHTML = '';
  renderTypeOptions();
  renderCurrent();
});
document.addEventListener('change', event => {
  const check = event.target.closest('[data-trash-check]');
  if (check) { check.checked ? selectedTrash.add(check.dataset.trashCheck) : selectedTrash.delete(check.dataset.trashCheck); renderTrash(); }
  const all = event.target.closest('[data-select-all]');
  if (all) { selectedTrash = all.checked ? new Set(trash.map(entry => entry.id)) : new Set(); renderTrash(); }
});
document.addEventListener('click', async event => {
  const toggle = event.target.closest('[data-nav-toggle]');
  if (toggle) {
    toggle.closest('.nav-dropdown').classList.toggle('open');
    return;
  }
  if (!event.target.closest('.nav-dropdown')) {
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  }
  const batch = event.target.closest('[data-permanent-selected]');
  if (batch && selectedTrash.size) {
    if (confirm(`确定永久删除选中的 ${selectedTrash.size} 件收藏吗？此操作无法恢复。`)) {
      await Promise.all([...selectedTrash].map(deleteRow));
      trash = trash.filter(entry => !selectedTrash.has(entry.id));
      selectedTrash = new Set();
      renderTrash();
    }
  }
});
(async () => { await initAuth(); await loadCategories(); renderTopNav(); renderTypeOptions(); const { entries: e, trash: t, migrated } = await loadData(); entries = e; trash = t; if (migrated) await persist(); renderCurrent(); })();
