# Как публиковать сайт на Cloudflare

## Что используется

- Worker — запускает сайт и API по адресу `*.workers.dev`.
- D1 — бесплатная SQLite-база в Cloudflare.
- Wrangler — официальная программа для публикации из терминала.

## Первый вход

```powershell
npx wrangler login
```

Откроется Cloudflare. Подтвердите доступ Wrangler к аккаунту.

## Создание базы

Это нужно сделать только для нового проекта:

```powershell
npx wrangler d1 create checkpoint-games
```

Команда покажет `database_id`. Вставьте его в `wrangler.jsonc`, затем создайте
таблицы:

```powershell
npx wrangler d1 execute checkpoint-games --remote --file=cloudflare-schema.sql
```

## Публикация

В этом проекте всё уже настроено в `wrangler.jsonc`: Worker, папка
`frontend`, D1-привязка `DB` и API-маршруты. Для публикации откройте PowerShell
в папке `API` и выполните:

```powershell
npx wrangler deploy
```

Каждое следующее изменение публикуется той же командой `npx wrangler deploy`.

## Проверка после публикации

```powershell
Invoke-RestMethod https://checkpoint-game-library.kramrun2.workers.dev/games/
```

Если вернулся JSON-массив, сайт и база связаны правильно.

## Свой домен

1. Добавьте домен в аккаунт Cloudflare и укажите выданные Cloudflare DNS-серверы
   у регистратора домена.
2. Откройте **Workers & Pages → checkpoint-game-library → Settings → Domains & Routes**.
3. Нажмите **Add → Custom Domain** и введите, например, `games.example.com`.

Хостинг Workers и небольшая D1-база помещаются в бесплатный тариф. Сам домен
обычно покупается отдельно у регистратора; адрес `workers.dev` бесплатный.

## Через панель Cloudflare

1. Workers & Pages → Create application.
2. Создайте Worker и задайте имя.
3. Edit code → вставьте код → Deploy.
4. Storage & databases → D1 → Create database.
5. Выполните SQL из `cloudflare-schema.sql` в Console.
6. Worker → Bindings → Add binding → D1 database.
7. Variable name должна быть `DB`.

Бесплатный адрес проекта: `https://checkpoint-game-library.kramrun2.workers.dev/`.
