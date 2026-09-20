const token = localStorage.getItem('checkpoint_token');
const list = document.querySelector('#ratingsList');
const empty = document.querySelector('#ratingsEmpty');
const errorBox = document.querySelector('#ratingsError');

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

async function loadRatings() {
  if (!token) {
    window.location.replace('/');
    return;
  }

  const response = await fetch('/community/library', {
    headers: {Authorization: `Bearer ${token}`},
  });

  if (response.status === 401) {
    localStorage.removeItem('checkpoint_token');
    window.location.replace('/');
    return;
  }
  if (!response.ok) throw new Error('Не удалось загрузить общую библиотеку');

  const ratings = await response.json();
  empty.hidden = ratings.length !== 0;
  list.innerHTML = ratings.map(game => `
    <article class="library-card">
      <div class="library-art">${game.cover_url ? `<img src="${escapeHtml(game.cover_url)}" alt="">` : `<span>${escapeHtml(game.title.slice(0, 1))}</span>`}</div>
      <div class="library-card-top"><span>${game.release_year || 'Год не указан'}</span><strong>${game.external_rating == null ? '—' : Number(game.external_rating).toFixed(1)}</strong></div>
      <h2>${escapeHtml(game.title)}</h2>
      <p class="library-genres">${escapeHtml(game.genres.length ? game.genres.slice(0, 3).join(' · ') : 'Жанр не указан')}</p>
      <p class="library-votes">Рейтинг из внешнего каталога RAWG</p>
    </article>
  `).join('');
}

loadRatings().catch(error => {
  errorBox.textContent = error.message;
  errorBox.hidden = false;
});
