# AI co-editing: deferred

Status: **deferred** by the user on 2026-11-05 ("drop ChatGPT for now, add AI co-editing later").
Everything below was measured on 2026-11-05 so the next attempt starts from facts.

## Intent (from the user)
- Humans edit decks manually, PowerPoint-canvas style. AI agents author and edit slides as HTML
  (domOXML IR → HTML needs no Chromium; HTML → IR uses the in-browser capture path in ENGINE.md D3).
- A chat panel on the desktop deck page, Vercel AI SDK or similar. Every tool call carries an `activity`
  param of at most four words; the UI shows activities (not tool names) and thinking, each held for at
  least 1.5–2 s before the next replaces it.
- Inference with the user's own accounts, fully client-side, multiple providers in Settings.

## What we measured

| Path | Browser-callable (CORS)? | Notes |
|---|---|---|
| Codex device-code sign-in (`auth.openai.com/api/accounts/deviceauth/*`, `/oauth/token`) | Yes (`*`) | How Inti signs in (client `app_EMoam…`, server-side) |
| Codex inference (`chatgpt.com/backend-api/codex/*`) | **No**: only `https://chatgpt.com` allowed; our origin gets 400 on preflight | Fundamental blocker for a page; Pi's `pi-web-ui` uses a CORS proxy for this |
| Official Sign in with ChatGPT (open source), token endpoint `auth.openai.com/api/accounts/oauth/token` | Yes (`*`) | `client_id=dynamic_agent_client`, PKCE, `resource=https://api.openai.com/v1`, scopes incl. `chatgpt.tokens.use.direct` |
| Official plan-usage inference `api.openai.com/v1/responses` | Yes (`*`) | |
| Official flow with a web redirect (`https://office.daft.onl/auth/callback`) | **Rejected**: `invalid_authorize_request`, `param: redirect_uri` (user tested in a real browser) | Only `http://127.0.0.1:<port>/…` loopback is accepted |
| Official flow via device code | **Rejected**: `invalid_client` "This app is unavailable" for `dynamic_agent_client` | |
| Device code with Codex's client + API scopes | Issued a code; whether the token works on `/v1/responses` is **untested** | Would mean impersonating the Codex CLI: not recommended |

## Options when this resumes
1. **Official SIWC with paste-back**: user approves, lands on the failing `127.0.0.1` page, pastes its URL;
   the browser exchanges the code (PKCE) and calls `/v1/responses` directly. Fully client-side, sanctioned.
2. **Request a registered client ID** with `https://<our domain>/auth/callback` (developers.openai.com/siwc/request-client-id)
   to remove the paste step. Hosted apps may be waitlisted.
3. Providers that allow browser calls directly: API keys for OpenAI, Anthropic, OpenRouter, Gemini; local Ollama/LM Studio.
4. A stateless CORS relay or a browser extension for the Codex backend: last resorts.
