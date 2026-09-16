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

  const response = await fetch('/games/ratings', {
    headers: {Authorization: `Bearer ${token}`},
  });

  if (response.status === 401) {
    localStorage.removeItem('checkpoint_token');
    window.location.replace('/');
    return;
  }
  if (!response.ok) throw new Error('Не удалось загрузить общий рейтинг');

  const ratings = await response.json();
  empty.hidden = ratings.length !== 0;
  list.innerHTML = ratings.map((game, index) => `
    <article class="rating-row">
      <strong class="rating-position">${index + 1}</strong>
      <div class="rating-game">
        <h2>${escapeHtml(game.title)}</h2>
        <span>${game.votes} ${game.votes === 1 ? 'оценка' : 'оценок'}</span>
      </div>
      <strong class="rating-value">${Number(game.average_rating).toFixed(1)}</strong>
    </article>
  `).join('');
}

loadRatings().catch(error => {
  errorBox.textContent = error.message;
  errorBox.hidden = false;
});
