const api = '/games/';
let games = [], activeFilter = 'all';
let token = localStorage.getItem('checkpoint_token');
let authMode = 'login';
let pendingCreateKey = null;
let currentUser = null;
let pendingTelegramAuthToken = null;
let publishingGame = null;
let pendingPublishKey = null;
let selectedGame = null;
const $ = (selector) => document.querySelector(selector);
const grid = $('#gamesGrid'), dialog = $('#gameDialog'), form = $('#gameForm');

function esc(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function toast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2800); }
function genreColor(genre) { const colors = ['#b9a6ff','#f19c7b','#68d7c4','#f0cb75','#83aaff']; let n = 0; for (const char of genre) n += char.charCodeAt(0); return colors[n % colors.length]; }
function updateStats() { const total = games.length, done = games.filter(g => g.completed).length, avg = total ? games.reduce((s, g) => s + g.rating, 0) / total : 0, pct = total ? Math.round(done / total * 100) : 0; $('#totalCount').textContent = total; $('#heroCount').textContent = total; $('#completedCount').textContent = done; $('#completionLabel').textContent = done ? `${total - done} в очереди` : 'ещё впереди'; $('#averageRating').textContent = total ? avg.toFixed(1) : '—'; $('#progressValue').textContent = `${pct}%`; $('#progressBar').style.width = `${pct}%`; }
function render() { const term = $('#searchInput').value.trim().toLowerCase(); const shown = games.filter(g => { const matchesSearch = !term || `${g.title} ${g.genre}`.toLowerCase().includes(term); const matchesFilter = activeFilter === 'all' || (activeFilter === 'completed' ? g.completed : !g.completed); return matchesSearch && matchesFilter; }); grid.innerHTML = shown.map(game => `<article class="game-card" data-game-id="${game.id}" tabindex="0" role="button" aria-label="Открыть меню игры ${esc(game.title)}"><div class="card-top"><span class="game-year">${game.year}</span><div class="card-menu"><button data-action="edit" data-id="${game.id}" aria-label="Редактировать">···</button></div></div><div class="game-art"><span>${esc(game.genre.slice(0, 1).toUpperCase())}</span></div><div class="game-info"><div><p>${esc(game.genre)}</p><h3>${esc(game.title)}</h3></div><b>${game.rating.toFixed(1)}</b></div><div class="card-bottom"><button class="status ${game.completed ? 'done' : ''}" data-action="complete" data-id="${game.id}"><span>${game.completed ? '✓' : '○'}</span>${game.completed ? 'Пройдено' : 'В процессе'}</button><span class="game-year">Открыть →</span></div></article>`).join(''); $('#emptyState').hidden = games.length !== 0; updateStats(); }
async function request(url = api, options = {}) { const headers = {...(options.headers || {})}; if (token) headers.Authorization = `Bearer ${token}`; const res = await fetch(url, {...options, headers}); if (res.status === 401) { localStorage.removeItem('checkpoint_token'); token = null; $('#authScreen').classList.remove('hidden'); } if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.detail || 'Не удалось выполнить запрос'); } return res.status === 204 ? null : res.json(); }
async function loadGames() { try { games = await request(); render(); } catch (e) { toast(`Ошибка API: ${e.message}`); } }
function openDetails(game) { selectedGame = game; $('#detailTitle').textContent = game.title; $('#detailGenre').textContent = game.genre; $('#detailYear').textContent = game.year; $('#detailRating').textContent = `${game.rating.toFixed(1)} / 10`; $('#detailCompleted').textContent = game.completed ? 'Пройдено' : 'В процессе'; $('#detailToggleButton').textContent = game.completed ? 'Вернуть в процесс' : 'Отметить пройденной'; $('#gameDetailsDialog').showModal(); }
function openForm(game) { form.reset(); pendingCreateKey = game ? null : crypto.randomUUID(); $('#gameId').value = game?.id || ''; $('#dialogTitle').textContent = game ? 'Изменить игру' : 'Добавить игру'; $('#title').value = game?.title || ''; $('#genre').value = game?.genre || ''; $('#year').value = game?.year || 2026; $('#rating').value = game?.rating || 8; $('#ratingOutput').textContent = (+$('#rating').value).toFixed(1); $('#completed').checked = game?.completed || false; dialog.showModal(); $('#title').focus(); }
['#openCreate','#openCreateAlt','#openEmpty'].forEach(id => $(id).addEventListener('click', () => openForm()));
$('#closeDialog').onclick = $('#cancelDialog').onclick = () => dialog.close(); $('#rating').oninput = e => $('#ratingOutput').textContent = (+e.target.value).toFixed(1);

async function createGame(body, idempotencyKey) {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  };

  try {
    return await request(api, options);
  } catch (error) {
    // Сетевой повтор обязан использовать тот же ключ.
    if (!(error instanceof TypeError)) throw error;
    return request(api, options);
  }
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#gameId').value;
  const saveButton = $('#saveButton');
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  const body = {
    title: $('#title').value.trim(),
    genre: $('#genre').value.trim(),
    year: +$('#year').value,
    rating: +$('#rating').value,
    completed: $('#completed').checked,
  };

  try {
    if (id) {
      await request(`${api}${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
    } else {
      pendingCreateKey ||= crypto.randomUUID();
      await createGame(body, pendingCreateKey);
      pendingCreateKey = null;
    }
    dialog.close();
    toast(id ? 'Игра обновлена' : 'Игра добавлена в коллекцию');
    await loadGames();
  } catch (err) {
    toast(err.message);
  } finally {
    saveButton.disabled = false;
  }
});
async function openPublish(game) {
  publishingGame = game;
  pendingPublishKey = crypto.randomUUID();
  $('#publishGameTitle').textContent = `Проверяем: ${game.title} (${game.year})`;
  $('#publishStatus').textContent = 'Ищем игру в общем каталоге…';
  $('#publishCandidate').innerHTML = '';
  $('#publishCandidate').disabled = true;
  $('#publishReview').value = '';
  $('#publishSubmit').disabled = true;
  $('#publishDialog').showModal();
  try {
    const result = await request('/community/validate-game', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({personal_game_id:game.id})});
    if (!result.candidates.length) { $('#publishStatus').textContent = 'Подходящая игра не найдена. Исправьте название или год в личной библиотеке.'; return; }
    $('#publishCandidate').innerHTML = result.candidates.map(candidate => `<option value="${esc(candidate.external_id)}">${esc(candidate.title)}${candidate.release_year ? ` (${candidate.release_year})` : ''}</option>`).join('');
    $('#publishCandidate').disabled = false;
    $('#publishSubmit').disabled = false;
    $('#publishStatus').textContent = 'Игра найдена в каталоге. При необходимости выберите другой вариант и добавьте отзыв.';
  } catch (error) { $('#publishStatus').textContent = error.message; }
}
grid.addEventListener('click', async e => { const button = e.target.closest('button[data-action]'); const card = e.target.closest('[data-game-id]'); const game = games.find(g => g.id === +(button?.dataset.id || card?.dataset.gameId)); if (!game) return; if (!button) return openDetails(game); if (button.dataset.action === 'edit') return openForm(game); try { if (button.dataset.action === 'complete') { await request(`${api}${game.id}/complete`, {method:'PATCH'}); toast('Отмечено как пройдено'); await loadGames(); } } catch(err) { toast(err.message); } });
grid.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-game-id]')) { e.preventDefault(); const game = games.find(g => g.id === +e.target.dataset.gameId); if (game) openDetails(game); } });
$('#closeDetailsDialog').onclick = () => $('#gameDetailsDialog').close();
$('#detailPublishButton').onclick = () => { if (!selectedGame) return; $('#gameDetailsDialog').close(); openPublish(selectedGame); };
$('#detailEditButton').onclick = () => { if (!selectedGame) return; $('#gameDetailsDialog').close(); openForm(selectedGame); };
$('#detailToggleButton').onclick = async () => { if (!selectedGame) return; try { await request(`${api}${selectedGame.id}/complete`, {method:'PATCH'}); toast('Статус игры обновлён'); await loadGames(); const updated = games.find(game => game.id === selectedGame.id); if (updated) openDetails(updated); } catch (error) { toast(error.message); } };
$('#detailDeleteButton').onclick = async () => { if (!selectedGame || !confirm(`Удалить «${selectedGame.title}»?`)) return; try { await request(`${api}${selectedGame.id}`, {method:'DELETE'}); $('#gameDetailsDialog').close(); toast('Игра удалена'); await loadGames(); } catch (error) { toast(error.message); } };
$('#closePublishDialog').onclick = $('#cancelPublishDialog').onclick = () => $('#publishDialog').close();
async function publishGame(body, idempotencyKey) {
  const options = {method:'POST', headers:{'Content-Type':'application/json', 'Idempotency-Key':idempotencyKey}, body:JSON.stringify(body)};
  try { return await request('/community/publish', options); }
  catch (error) { if (!(error instanceof TypeError)) throw error; return request('/community/publish', options); }
}
$('#publishForm').addEventListener('submit', async event => { event.preventDefault(); if (!publishingGame || !$('#publishCandidate').value) return; const button = $('#publishSubmit'); if (button.disabled) return; button.disabled = true; $('#publishStatus').textContent = ''; try { await publishGame({personal_game_id:publishingGame.id, external_id:$('#publishCandidate').value, review_text:$('#publishReview').value.trim()}, pendingPublishKey ||= crypto.randomUUID()); pendingPublishKey = null; $('#publishDialog').close(); toast('Игра опубликована в общей библиотеке'); } catch (error) { $('#publishStatus').textContent = error.message; } finally { button.disabled = false; } });
$('#searchInput').addEventListener('input', render); $('#filters').addEventListener('click', e => { const button = e.target.closest('button'); if (!button) return; activeFilter = button.dataset.filter; document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === button)); render(); });
$('#recommendButton').onclick = async () => { try { const game = await request(`${api}recommend`); toast(`Ваш следующий мир: ${game.title}`); document.querySelector(`[data-id="${game.id}"]`)?.closest('.game-card')?.scrollIntoView({behavior:'smooth', block:'center'}); } catch (e) { toast('Нет непройденных игр с рейтингом от 7'); } };

function updateTelegramButton() { $('#telegramButton').textContent = currentUser?.telegram_linked ? 'Telegram ✓' : 'Telegram'; }
function showUser(user) { currentUser = user; $('#currentUser').textContent = user.username; updateTelegramButton(); $('#authScreen').classList.add('hidden'); }
$('#authSwitch').onclick = () => { authMode = authMode === 'login' ? 'register' : 'login'; const registering = authMode === 'register'; $('#authTitle').textContent = registering ? 'Регистрация' : 'Вход'; $('#authSubmit').firstChild.textContent = registering ? 'Создать аккаунт ' : 'Войти '; $('#authSwitch').textContent = registering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'; $('#authPassword').autocomplete = registering ? 'new-password' : 'current-password'; $('#authError').textContent = ''; };
$('#telegramAuthButton').onclick = async () => { const button = $('#telegramAuthButton'); if (button.disabled) return; button.disabled = true; $('#telegramAuthError').textContent = ''; try { const result = await request('/auth/telegram-auth-link', {method: 'POST'}); pendingTelegramAuthToken = result.auth_token; $('#telegramAuthFields').hidden = false; $('#telegramAuthError').textContent = 'Подтвердите контакт в боте, затем введите код.'; window.open(result.telegram_url, '_blank', 'noopener'); } catch (error) { $('#telegramAuthError').textContent = error.message; } finally { button.disabled = false; } };
$('#telegramAuthConfirm').onclick = async () => { const button = $('#telegramAuthConfirm'); if (button.disabled) return; button.disabled = true; $('#telegramAuthError').textContent = ''; try { const result = await request('/auth/telegram-auth-confirm', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: $('#telegramAuthCode').value.trim(), auth_token: pendingTelegramAuthToken})}); token = result.access_token; localStorage.setItem('checkpoint_token', token); pendingTelegramAuthToken = null; showUser(result.user); await loadGames(); } catch (error) { $('#telegramAuthError').textContent = error.message; } finally { button.disabled = false; } };
async function createTelegramLink() { const result = await request('/auth/telegram-link', {method: 'POST'}); $('#telegramStatus').innerHTML = `В боте нажмите «Подтвердить номер», затем введите код ниже. <a href="${esc(result.telegram_url)}" target="_blank" rel="noopener">Открыть Telegram</a>`; window.open(result.telegram_url, '_blank', 'noopener'); }
$('#authForm').addEventListener('submit', async event => { event.preventDefault(); $('#authError').textContent = ''; const registering = authMode === 'register'; try { const result = await request(`/auth/${authMode}`, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username: $('#authUsername').value.trim(), password: $('#authPassword').value})}); token = result.access_token; localStorage.setItem('checkpoint_token', token); showUser(result.user); await loadGames(); if (registering) { $('#telegramStatus').textContent = 'Подключите Telegram, когда будете готовы.'; $('#telegramDialog').showModal(); } } catch (error) { $('#authError').textContent = error.message; } });
$('#telegramButton').onclick = () => { $('#telegramStatus').textContent = currentUser?.telegram_linked ? `Telegram подключён${currentUser.phone ? `: ${currentUser.phone}` : ''}. Чтобы сменить аккаунт, пройдите привязку заново.` : 'Откройте Telegram, разрешите отправку контакта и введите код.'; $('#telegramCode').value = ''; $('#telegramDialog').showModal(); };
$('#closeTelegramDialog').onclick = $('#cancelTelegramDialog').onclick = () => $('#telegramDialog').close();
$('#telegramLinkButton').onclick = async () => { const button = $('#telegramLinkButton'); if (button.disabled) return; button.disabled = true; $('#telegramStatus').textContent = ''; try { await createTelegramLink(); } catch (error) { $('#telegramStatus').textContent = error.message; } finally { button.disabled = false; } };
$('#telegramForm').addEventListener('submit', async event => { event.preventDefault(); const button = $('#telegramSubmit'); if (button.disabled) return; button.disabled = true; $('#telegramStatus').textContent = ''; try { currentUser = await request('/auth/telegram-confirm', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: $('#telegramCode').value.trim()})}); showUser(currentUser); $('#telegramDialog').close(); toast('Telegram подключён'); } catch (error) { $('#telegramStatus').textContent = error.message; } finally { button.disabled = false; } });
$('#logoutButton').onclick = async () => { try { await request('/auth/logout', {method:'POST'}); } catch (_) {} localStorage.removeItem('checkpoint_token'); token = null; currentUser = null; games = []; render(); $('#authForm').reset(); $('#authScreen').classList.remove('hidden'); };

async function init() { if (!token) return; try { const user = await request('/auth/me'); showUser(user); await loadGames(); } catch (_) { $('#authScreen').classList.remove('hidden'); } }
init();
