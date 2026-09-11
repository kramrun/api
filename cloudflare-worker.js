const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {"content-type": "application/json;charset=utf-8"},
});

const encoder = new TextEncoder();
const SESSION_SECONDS = 7 * 24 * 60 * 60;
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

async function createSession(db, user) {
  const token = randomToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await db.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .bind(await sha256(token), user.id, expiresAt).run();
  return {access_token: token, token_type: "bearer", user: {id: user.id, username: user.username}};
}

async function authenticate(request, db) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare(
    "SELECT s.id AS session_id,s.expires_at,u.id,u.username FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?",
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
        return json({id: session.id, username: session.username});
      }
      if (path === "/auth/logout" && request.method === "POST") {
        await db.prepare("DELETE FROM auth_sessions WHERE id=?").bind(session.session_id).run();
        return new Response(null, {status: 204});
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
