# Functional tests

Tests that run against the **running stack** over real HTTP, with its real configuration. They cover
behaviour that only makes sense end to end, such as the per-IP rate limits, which are counted per network
address in the server's memory using the limits we actually ship.

They are **local only**: not part of `npm test`, `npm run check` or CI.

## Running

```sh
docker compose up -d --wait --build   # with CAPTCHA_FIXED=true in .env (the npm run dev:setup default)
docker compose restart server         # fresh in-memory limits; a previous run leaves them used up
npm run test:functional
```

Point them at another server with `FUNCTIONAL_BASE_URL=http://host:port`.

## Side effects

- The login rate limit for your machine's address stays used up for one minute afterwards, so signing in
  from the API explorer fails with `rate_limited` until it resets (or restart the server).
- The tests only use usernames that don't exist; they create no data.
