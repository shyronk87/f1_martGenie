# MartGennie Frontend

## Overview
This is the Next.js frontend for MartGennie. It serves the main site, chat workspace, packages page, negotiation page, plaza, auth callback, and profile flows.

## Environment Setup
1. Copy the example file:
```bash
cp .env.example .env
```
2. Review these variables:

- `PORT`: local frontend port. Default is `8001`.
- `NEXT_PUBLIC_API_BASE_URL`: browser REST base. Keep `/api` for local development.
- `BACKEND_ORIGIN`: backend origin used by Next rewrites. Usually `http://127.0.0.1:8000`.
- `NEXT_PUBLIC_BACKEND_ORIGIN`: backend origin used by browser-side SSE for chat and negotiation streams.
- `NEXT_PUBLIC_CHAT_MODE`: use `real` unless you are testing mock flows.

Most frontend values do not need to be requested from a vendor. They should match your local backend address. If you change backend host or port, update both `BACKEND_ORIGIN` and `NEXT_PUBLIC_BACKEND_ORIGIN`.

## Install and Run
Install dependencies:
```bash
npm install
```

Start the dev server:
```bash
npm run dev
```

Open:
```text
http://localhost:8001
```

## Useful Commands
- `npm run dev`: start the development server.
- `npm run build`: create a production build.
- `npm run start`: run the production build locally.
- `npm run lint`: run ESLint.

## Notes
- The frontend expects the backend to be running before chat, packages, plaza recommendations, negotiation, or auth flows will work.
- Google sign-in also depends on the backend OAuth configuration being correct.
