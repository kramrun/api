const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {"content-type": "application/json;charset=utf-8"},
});

const encoder = new TextEncoder();
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const PHONE_VERIFICATION_SECONDS = 15 * 60;
const TELEGRAM_CODE_SECONDS = 10 * 60;
const TELEGRAM_CODE_MAX_ATTEMPTS = 5;
// Cloudflare Web Crypto currently caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS},
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) digits = `+${digits}`;
  const plain = digits.slice(1);
  if (plain.length === 11 && plain.startsWith("8")) return `+7${plain.slice(1)}`;
  if (plain.length < 10 || plain.length > 15 || !/^\d+$/.test(plain)) return null;
  return `+${plain}`;
}

function randomConfirmationCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(value).padStart(6, "0");
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    phone: user.phone || null,
    phone_verified: Boolean(user.phone_verified_at),
    telegram_linked: Boolean(user.telegram_id),
  };
}

async function sendTelegram(env, chatId, text, extra = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({chat_id: chatId, text, ...extra}),
  });
  if (!response.ok) throw new Error(`Telegram sendMessage failed: ${response.status}`);
}

function telegramCommand(text) {
  const [command = "", ...argumentsList] = String(text || "").trim().split(/\s+/);
  return {command: command.toLowerCase().replace(/@[^\s]+$/, ""), argumentsText: argumentsList.join(" ")};
}

function parseTelegramGame(value) {
  const [title, genre, yearText, ratingText, completedText] = value.split("|").map(part => part.trim());
  const year = Number(yearText);
  const rating = Number(ratingText);
  const completed = ["да", "пройдена", "пройдено", "yes", "true", "1"].includes(String(completedText || "").toLowerCase());
  if (!title || title.length > 120 || !genre || genre.length > 60 || !Number.isInteger(year) || year < 1970 || year > 2026 || !Number.isFinite(rating) || rating < 0 || rating > 10) return null;
  return {title, genre, year, rating, completed};
}

async function telegramUser(db, telegramId) {
  return db.prepare("SELECT * FROM users WHERE telegram_id=?").bind(String(telegramId)).first();
}

async function createTelegramGame(db, user, game, updateId) {
  const idempotencyKey = `telegram-update-${updateId}`;
  const requestHash = await sha256(JSON.stringify(game));
  const reservation = await db.prepare(`
    INSERT OR IGNORE INTO idempotency_records(
      user_id,idempotency_key,request_hash,response_json,status_code,created_at
    ) VALUES(?,?,?,NULL,NULL,?)
  `).bind(user.id, idempotencyKey, requestHash, Math.floor(Date.now() / 1000)).run();

  if (!reservation.meta.changes) {
    const previous = await db.prepare(`
      SELECT request_hash,response_json FROM idempotency_records WHERE user_id=? AND idempotency_key=?
    `).bind(user.id, idempotencyKey).first();
    if (previous.request_hash !== requestHash) throw new Error("Telegram update payload changed");
    return {replayed: true, processing: previous.response_json === null};
  }

  try {
    const [result] = await db.batch([
      db.prepare("INSERT INTO games(title,genre,year,rating,completed,owner_id) VALUES(?,?,?,?,?,?)")
        .bind(game.title, game.genre, game.year, game.rating, game.completed ? 1 : 0, user.id),
      db.prepare(`
        UPDATE idempotency_records SET response_json=json_object('id',last_insert_rowid()),status_code=201
        WHERE user_id=? AND idempotency_key=?
      `).bind(user.id, idempotencyKey),
    ]);
    return {id: result.meta.last_row_id, replayed: false, processing: false};
  } catch (error) {
    await db.prepare(`
      DELETE FROM idempotency_records WHERE user_id=? AND idempotency_key=? AND response_json IS NULL
    `).bind(user.id, idempotencyKey).run();
    throw error;
  }
}

async function handleTelegramMessage(message, env, db, updateId) {
  const chatId = message?.chat?.id;
  const telegramId = message?.from?.id;
  if (chatId === undefined || telegramId === undefined) return;

  const now = Math.floor(Date.now() / 1000);
  const text = message.text || "";
  const {command, argumentsText} = telegramCommand(text);

  if (command === "/start") {
    const token = argumentsText.startsWith("verify_") ? argumentsText.slice("verify_".length) : "";
    if (token) {
      const verification = await db.prepare(`
        SELECT id FROM phone_verifications WHERE verification_token=? AND expires_at>?
      `).bind(token, now).first();
      if (!verification) {
        await sendTelegram(env, chatId, "Ссылка уже использована или истекла. Создайте новую на сайте.");
        return;
      }
      await db.prepare(`
        UPDATE phone_verifications SET telegram_user_id=?, telegram_chat_id=? WHERE id=?
      `).bind(String(telegramId), String(chatId), verification.id).run();
      await sendTelegram(env, chatId, "Разрешите боту получить ваш контакт кнопкой ниже. После этого я пришлю код подтверждения в этот чат.", {
        reply_markup: {
          keyboard: [[{text: "Подтвердить номер", request_contact: true}]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return;
    }
    const user = await telegramUser(db, telegramId);
    await sendTelegram(env, chatId, user
      ? "Checkpoint подключён. Команды: /rating — моя статистика, /add — добавить игру."
      : "Сначала привяжите Telegram: https://checkpoint-game-library.kramrun2.workers.dev/ — войдите или зарегистрируйтесь, нажмите Telegram и откройте ссылку на бота.");
    return;
  }

  if (message.contact) {
    const verification = await db.prepare(`
      SELECT * FROM phone_verifications
      WHERE telegram_user_id=? AND telegram_chat_id=? AND expires_at>?
      ORDER BY created_at DESC LIMIT 1
    `).bind(String(telegramId), String(chatId), now).first();
    const contactPhone = normalizePhone(message.contact.phone_number);
    if (!verification) {
      await sendTelegram(env, chatId, "Нет активной заявки на подтверждение. Создайте новую на сайте.");
      return;
    }
    if (String(message.contact.user_id || "") !== String(telegramId) || !contactPhone) {
      await sendTelegram(env, chatId, "Отправьте именно свой контакт кнопкой Telegram.");
      return;
    }
    const taken = await db.prepare("SELECT id FROM users WHERE telegram_id=? AND id<>?").bind(String(telegramId), verification.user_id).first();
    if (taken) {
      await sendTelegram(env, chatId, "Этот Telegram уже привязан к другому аккаунту Checkpoint.");
      return;
    }
    try {
      const code = randomConfirmationCode();
      await db.prepare(`
        UPDATE phone_verifications
        SET phone=?,confirmation_code_hash=?,code_expires_at=?,code_attempts=0
        WHERE id=?
      `).bind(contactPhone, await sha256(`${verification.verification_token}:${code}`), now + TELEGRAM_CODE_SECONDS, verification.id).run();
      await sendTelegram(env, chatId, `Ваш код Checkpoint: ${code}\nВведите его на сайте в течение 10 минут.`, {reply_markup: {remove_keyboard: true}});
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) {
        await sendTelegram(env, chatId, "Не удалось отправить код. Создайте новую привязку на сайте.");
        return;
      }
      throw error;
    }
    return;
  }

  const user = await telegramUser(db, telegramId);
  if (!user) {
    await sendTelegram(env, chatId, "Сначала привяжите Telegram: https://checkpoint-game-library.kramrun2.workers.dev/ — войдите или зарегистрируйтесь, нажмите Telegram и откройте ссылку на бота.");
    return;
  }

  if (command === "/rating") {
    const stats = await db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) AS completed, ROUND(AVG(rating), 1) AS average_rating
      FROM games WHERE owner_id=?
    `).bind(user.id).first();
    await sendTelegram(env, chatId, `Ваша библиотека: ${stats.total} игр\nПройдено: ${stats.completed || 0}\nСредняя оценка: ${stats.average_rating ?? "—"}`);
    return;
  }

  if (command === "/add") {
    const game = parseTelegramGame(argumentsText);
    if (!game) {
      await sendTelegram(env, chatId, "Формат: /add Название | Жанр | Год | Рейтинг | пройдена\nПример: /add Hades | Roguelike | 2020 | 9.5 | пройдена");
      return;
    }
    const result = await createTelegramGame(db, user, game, updateId);
    if (result.processing) return;
    await sendTelegram(env, chatId, result.replayed
      ? `«${game.title}» уже есть в вашей библиотеке.`
      : `«${game.title}» добавлена в вашу библиотеку.`);
    return;
  }

  await sendTelegram(env, chatId, "Команды:\n/rating — моя статистика\n/add Название | Жанр | Год | Рейтинг | пройдена — добавить игру");
}

async function createSession(db, user) {
  const token = randomToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await db.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .bind(await sha256(token), user.id, expiresAt).run();
  return {access_token: token, token_type: "bearer", user: publicUser(user)};
}

async function authenticate(request, db) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare(
    "SELECT s.id AS session_id,s.expires_at,u.id,u.username,u.phone,u.phone_verified_at,u.telegram_id FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?",
  ).bind(await sha256(token)).first();
  if (!session || session.expires_at <= now) {
    if (session) await db.prepare("DELETE FROM auth_sessions WHERE id=?").bind(session.session_id).run();
    return null;
  }
  return session;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB;

    if (path === "/telegram/webhook" && request.method === "POST") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("Not found", {status: 404});
      }
      let update;
      try { update = await request.json(); } catch { return json({ok: false}, 400); }
      if (!Number.isInteger(update.update_id)) return json({ok: true});
      const recorded = await db.prepare("INSERT OR IGNORE INTO telegram_updates(update_id,created_at,processed_at) VALUES(?,?,NULL)")
        .bind(update.update_id, Math.floor(Date.now() / 1000)).run();
      if (!recorded.meta.changes) {
        const previous = await db.prepare("SELECT processed_at FROM telegram_updates WHERE update_id=?").bind(update.update_id).first();
        if (previous?.processed_at) return json({ok: true});
      }
      if (update.message) await handleTelegramMessage(update.message, env, db, update.update_id);
      await db.prepare("UPDATE telegram_updates SET processed_at=? WHERE update_id=?")
        .bind(Math.floor(Date.now() / 1000), update.update_id).run();
      return json({ok: true});
    }

    if ((path === "/auth/register" || path === "/auth/login") && request.method === "POST") {
      let credentials;
      try { credentials = await request.json(); } catch { return json({detail: "Invalid JSON"}, 400); }
      const username = String(credentials.username || "").trim().toLowerCase();
      const password = String(credentials.password || "");
      if (username.length < 3 || username.length > 50 || password.length < 8 || password.length > 128) {
        return json({detail: "Логин: 3–50 символов, пароль: 8–128 символов"}, 422);
      }

      if (path === "/auth/register") {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        try {
          const result = await db.prepare("INSERT INTO users(username,password_hash,password_salt) VALUES(?,?,?)")
            .bind(username, await passwordHash(password, salt), toBase64(salt)).run();
          return json(await createSession(db, {id: result.meta.last_row_id, username}), 201);
        } catch (error) {
          if (String(error).toLowerCase().includes("unique")) return json({detail: "Такой логин уже существует"}, 409);
          throw error;
        }
      }

      const user = await db.prepare("SELECT * FROM users WHERE username=?").bind(username).first();
      if (!user || !safeEqual(await passwordHash(password, fromBase64(user.password_salt)), user.password_hash)) {
        return json({detail: "Неверный логин или пароль"}, 401);
      }
      return json(await createSession(db, user));
    }

    if (path.startsWith("/auth/") || path.startsWith("/games/")) {
      const session = await authenticate(request, db);
      if (!session) return json({detail: "Authentication required"}, 401);

      if (path === "/auth/me" && request.method === "GET") {
        return json(publicUser(session));
      }
      if (path === "/auth/logout" && request.method === "POST") {
        await db.prepare("DELETE FROM auth_sessions WHERE id=?").bind(session.session_id).run();
        return new Response(null, {status: 204});
      }
      if (path === "/auth/telegram-link" && request.method === "POST") {
        const botUsername = String(env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
        if (!/^[A-Za-z0-9_]{5,}$/.test(botUsername)) {
          return json({detail: "Telegram-бот ещё не настроен"}, 503);
        }
        const verificationToken = randomToken(24);
        const now = Math.floor(Date.now() / 1000);
        await db.batch([
          db.prepare("DELETE FROM phone_verifications WHERE user_id=?").bind(session.id),
          db.prepare(`
            INSERT INTO phone_verifications(user_id,phone,verification_token,expires_at,created_at)
            VALUES(?,?,?,?,?)
          `).bind(session.id, "", verificationToken, now + PHONE_VERIFICATION_SECONDS, now),
        ]);
        return json({
          telegram_url: `https://t.me/${botUsername}?start=verify_${verificationToken}`,
          expires_in: PHONE_VERIFICATION_SECONDS,
        }, 201);
      }
      if (path === "/auth/telegram-confirm" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({detail: "Invalid JSON"}, 400); }
        const code = String(body.code || "").trim();
        if (!/^\d{6}$/.test(code)) return json({detail: "Введите шестизначный код из Telegram"}, 422);
        const now = Math.floor(Date.now() / 1000);
        const verification = await db.prepare(`
          SELECT * FROM phone_verifications WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 1
        `).bind(session.id, now).first();
        if (!verification || !verification.confirmation_code_hash || !verification.code_expires_at || verification.code_expires_at <= now) {
          return json({detail: "Код истёк. Создайте новую привязку Telegram"}, 410);
        }
        if (verification.code_attempts >= TELEGRAM_CODE_MAX_ATTEMPTS) {
          return json({detail: "Слишком много попыток. Создайте новую привязку Telegram"}, 429);
        }
        const valid = safeEqual(await sha256(`${verification.verification_token}:${code}`), verification.confirmation_code_hash);
        if (!valid) {
          await db.prepare("UPDATE phone_verifications SET code_attempts=code_attempts+1 WHERE id=?").bind(verification.id).run();
          return json({detail: "Неверный код"}, 422);
        }
        const taken = await db.prepare("SELECT id FROM users WHERE telegram_id=? AND id<>?")
          .bind(verification.telegram_user_id, session.id).first();
        if (taken) return json({detail: "Этот Telegram уже привязан к другому аккаунту"}, 409);
        try {
          await db.batch([
            db.prepare("UPDATE users SET phone=?,phone_verified_at=?,telegram_id=?,telegram_chat_id=? WHERE id=?")
              .bind(verification.phone, now, verification.telegram_user_id, verification.telegram_chat_id, session.id),
            db.prepare("DELETE FROM phone_verifications WHERE id=?").bind(verification.id),
          ]);
        } catch (error) {
          if (String(error).toLowerCase().includes("unique")) return json({detail: "Этот номер уже привязан к другому аккаунту"}, 409);
          throw error;
        }
        const user = await db.prepare("SELECT * FROM users WHERE id=?").bind(session.id).first();
        return json(publicUser(user));
      }

      if (path === "/games/" && request.method === "GET") {
        const {results} = await db.prepare("SELECT * FROM games WHERE owner_id=? ORDER BY id DESC").bind(session.id).all();
        return json(results.map(game => ({...game, completed: Boolean(game.completed)})));
      }



      if (path === "/games/" && request.method === "POST") {
        const idempotencyKey = request.headers.get("Idempotency-Key");
        if (!idempotencyKey || idempotencyKey.length > 200) {
          return json({detail: "Valid Idempotency-Key is required"}, 400);
        }

        const requestBody = await request.text();
        const requestHash = await sha256(requestBody);
        let game;
        try {
          game = JSON.parse(requestBody);
        } catch {
          return json({detail: "Invalid JSON"}, 400);
        }

        const createdAt = Math.floor(Date.now() / 1000);
        const reservation = await db.prepare(`
          INSERT OR IGNORE INTO idempotency_records(
            user_id,idempotency_key,request_hash,response_json,status_code,created_at
          ) VALUES(?,?,?,NULL,NULL,?)
        `).bind(session.id, idempotencyKey, requestHash, createdAt).run();

        if (!reservation.meta.changes) {
          const previous = await db.prepare(`
            SELECT request_hash,response_json,status_code
            FROM idempotency_records
            WHERE user_id=? AND idempotency_key=?
          `).bind(session.id, idempotencyKey).first();

          if (previous.request_hash !== requestHash) {
            return json({detail: "Idempotency-Key was already used for another request"}, 409);
          }
          if (previous.response_json === null) {
            return json({detail: "Request with this Idempotency-Key is still processing"}, 409);
          }
          return new Response(previous.response_json, {
            status: previous.status_code,
            headers: {
              "content-type": "application/json;charset=utf-8",
              "Idempotency-Replayed": "true",
            },
          });
        }

        try {
          const [result] = await db.batch([
            db.prepare("INSERT INTO games(title,genre,year,rating,completed,owner_id) VALUES(?,?,?,?,?,?)")
              .bind(game.title, game.genre, game.year, game.rating, game.completed ? 1 : 0, session.id),
            db.prepare(`
              UPDATE idempotency_records
              SET response_json=json_object(
                'title',?,'genre',?,'year',?,'rating',?,
                'completed',json(CASE WHEN ?=1 THEN 'true' ELSE 'false' END),
                'id',last_insert_rowid()
              ), status_code=201
              WHERE user_id=? AND idempotency_key=?
            `).bind(
              game.title, game.genre, game.year, game.rating, game.completed ? 1 : 0,
              session.id, idempotencyKey,
            ),
          ]);

          return json({
            ...game,
            id: result.meta.last_row_id,
            completed: Boolean(game.completed),
          }, 201);
        } catch (error) {
          await db.prepare(`
            DELETE FROM idempotency_records
            WHERE user_id=? AND idempotency_key=? AND response_json IS NULL
          `).bind(session.id, idempotencyKey).run();
          throw error;
        }
      }


      if (path === "/games/ratings" && request.method === "GET") {
        const {results} = await db.prepare(`
          WITH user_ratings AS (
            SELECT
              owner_id,
              LOWER(TRIM(title)) AS title_key,
              MAX(title) AS title,
              AVG(rating) AS user_rating
            FROM games
            WHERE owner_id IS NOT NULL
            GROUP BY owner_id, LOWER(TRIM(title))
          )
          SELECT
            title_key,
            MAX(title) AS title,
            ROUND(AVG(user_rating), 2) AS average_rating,
            COUNT(*) AS votes
          FROM user_ratings
          GROUP BY title_key
          ORDER BY average_rating DESC, votes DESC, title ASC
          LIMIT 100
        `).all();
        return json(results);
      }

      if (path === "/games/recommend" && request.method === "GET") {
        const game = await db.prepare("SELECT * FROM games WHERE owner_id=? AND completed=0 AND rating>=7 ORDER BY RANDOM() LIMIT 1").bind(session.id).first();
        return game ? json({...game, completed: Boolean(game.completed)}) : json({detail: "No recommendations found"}, 404);
      }
      const match = path.match(/^\/games\/(\d+)(\/complete)?$/);
      if (match) {
        const id = Number(match[1]);
        if (match[2] && request.method === "PATCH") {
          await db.prepare("UPDATE games SET completed=1 WHERE id=? AND owner_id=?").bind(id, session.id).run();
          const game = await db.prepare("SELECT * FROM games WHERE id=? AND owner_id=?").bind(id, session.id).first();
          return game ? json({...game, completed: true}) : json({detail: "Game not found"}, 404);
        }
        if (request.method === "PUT") {
          const game = await request.json();
          const result = await db.prepare("UPDATE games SET title=?,genre=?,year=?,rating=?,completed=? WHERE id=? AND owner_id=?")
            .bind(game.title, game.genre, game.year, game.rating, game.completed ? 1 : 0, id, session.id).run();
          return result.meta.changes
            ? json({...game, id, completed: Boolean(game.completed)})
            : json({detail: "Game not found"}, 404);
        }
        if (request.method === "DELETE") {
          const result = await db.prepare("DELETE FROM games WHERE id=? AND owner_id=?").bind(id, session.id).run();
          return result.meta.changes ? new Response(null, {status: 204}) : json({detail: "Game not found"}, 404);
        }
      }
    }

    if (path.startsWith("/assets/")) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = path.slice("/assets".length);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ASSETS.fetch(request);
  },
};
