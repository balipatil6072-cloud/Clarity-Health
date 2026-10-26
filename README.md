# Clarity Health — Patient Record Analysis & Monitoring

A college DTI project MVP for organizing synthetic patient records, extracting basic results from text-based PDFs, comparing dated measurements, and preparing source-linked summaries for patient and clinician review.

> **Medical safety:** This is an educational prototype, not a medical device or source of diagnosis or treatment. Results and AI-assisted explanations require review by a qualified clinician. It cannot rule out an emergency. The included records are fictional. Do not upload real patient information without appropriate authorization, consent, security review, and legal review.

## Features

- Responsive public overview, patient, clinician, and administrator workspaces.
- Patient registration and login with bcrypt password hashes and an HTTP-only JWT cookie. Public registration always creates a patient account.
- Development demo accounts for patient, clinician, and administrator, with synthetic reports, trends, and assigned clinician access.
- Private PDF and image uploads with generated server filenames, size/MIME/extension and file-signature checks. Uploaded files live under `server/uploads` and are never publicly served.
- Conservative extraction for a small list of common lab tests from text-based hospital/clinic PDFs. PDF values must remain supported by the extracted source text. Unrelated or unreadable PDFs are rejected.
- Optional server-side vision reads uploaded PDFs, including scanned pages, and supported report images. It extracts candidate lab values with evidence quotes and page numbers; patients must verify them against the source. Without an API key, selectable-text PDFs use the local parser and photos require confirmed manual transcription.
- Deterministic comparison against the reference range stated in the report. A missing range remains “Unable to determine.”
- Optional server-only vision extraction and report analysis. Patient report chat answers from one selected, access-checked report and shows source evidence. Without a key, the labeled fallback uses only saved data from that report and does not create sample results.
- Patient history, date/search filters, unit-matched trend charts, source filenames, clinician review notes, follow-up tasks, account management, and audit events.
- MongoDB persistence when configured; in-memory demo storage otherwise.

## Architecture

- `client/`: React, Vite, React Router, Axios, Tailwind CSS, Recharts, Lucide React, and responsive project CSS.
- `server/src/app.js`: Express routes, validation, file handling, authorization, rate limits, and error handling.
- `server/src/models/`: Mongoose schemas for users, profiles, reports/results, analyses, notes, follow-ups, and audit logs.
- `server/src/services/`: storage adapter, PDF parsing, deterministic comparison, trend grouping, and optional LLM adapter.
- `server/uploads/`: private report file storage (ignored by Git).
- `server/tests/`: Node’s built-in test runner checks for analysis and API access control.

## Prerequisites

- Node.js 20 or later and npm.
- MongoDB 6 or later for durable storage (local MongoDB or MongoDB Atlas). MongoDB is optional for an in-memory demo.

## Install and configure

```bash
npm install
Copy-Item .env.example .env
```

Open `.env` and set at least a long random `JWT_SECRET`. Keep `.env` private and out of source control.

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port (default `4000`) |
| `CLIENT_ORIGIN` | Allowed browser origin (local default `http://localhost:5173`) |
| `VITE_API_BASE` | Client API base path/origin (default `/api`; set at Vite build time if needed) |
| `JWT_SECRET` | Secret used to sign session cookies; replace the example value |
| `COOKIE_SECURE` | Set `true` behind HTTPS in production; keep `false` for local HTTP |
| `MONGODB_URI` | MongoDB connection. Leave empty for memory-only demo mode |
| `DEMO_MODE` | `true` provisions synthetic demo accounts and reports; use `false` in production |
   | OPENAI_API_KEY | Optional server-only key. Set it to enable vision extraction for PDFs/images and LLM explanations/chat; without it, labeled deterministic/manual fallbacks are used |
| `OPENAI_MODEL` | Provider model name (default `gpt-4o-mini`) |
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL |
| `MAX_UPLOAD_MB` | Upload limit (default 10 MB) |

The server attempts MongoDB when a URI is present. If MongoDB is unavailable and `DEMO_MODE=true`, it clearly falls back to memory; memory data is lost when the process stops. For durable local development, start MongoDB and keep the supplied local URI. For Atlas, use the Atlas connection string and configure the deployment network allowlist.

## Run locally

In one terminal:

```bash
npm run dev
```

Vite serves the client at `http://localhost:5173` and proxies `/api` requests to Express at `http://localhost:4000`.

To run each side separately:

```bash
npm run dev:server
npm run dev:client
```

For a production build and one-process static serving (first configure a persistent MongoDB URI, a 32+ character `JWT_SECRET`, `DEMO_MODE=false`, and `COOKIE_SECURE=true`):

```bash
npm run build
NODE_ENV=production npm start
```

On Windows PowerShell, set production mode with `$env:NODE_ENV='production'; npm start`. The server refuses to start in production without persistent storage, secure cookies, demo provisioning disabled, and a sufficiently long JWT secret.

## Demo accounts

With `DEMO_MODE=true`, sign in from the login page using:

| Role | Email | Password |
| --- | --- | --- |
| Patient | `patient@clarity.demo` | Generated at server startup; choose Patient on the sign-in page |
| Clinician | `doctor@clarity.demo` | Generated at server startup; choose Clinician on the sign-in page |
| Administrator | `admin@clarity.demo` | Generated at server startup; choose Administrator on the sign-in page |

Local demo passwords are random for each server start and are shown in the sign-in form only while `DEMO_MODE=true`. Existing demo account hashes are rotated at startup. Vercel Preview deployments use the configured `DEMO_*_PASSWORD` values so separate serverless instances share credentials. These accounts and reports contain synthetic data for demonstrations. Do not enable demo provisioning in Production. Users cannot select a privileged role during registration. The demo clinician is explicitly assigned to the demo patient. Other patients are not visible unless access is granted by the application’s authorized setup process.

## Demonstrate the workflow

1. Sign in as the demo patient. Review the fictional January and April history, flagged values, and the trend chart.
2. Choose **Add a report** and upload a hospital/clinic PDF or report photo. Enter its date and category. With OPENAI_API_KEY configured, the server sends the selected file to the configured provider for vision extraction.
3. Check each extracted value and source quote against the file, correct mistakes, confirm the source, then save and analyze. Without an AI key, manually transcribe a report photo and confirm the values.
4. Open the source-linked analysis. Findings outside the stated range are informational, not diagnoses; missing ranges remain unknown.
5. Sign in as the demo clinician. Review the assigned patient, source evidence, and summary, then add a review note or follow-up task.
6. Sign in as the administrator to inspect account status, application health, and non-sensitive audit actions. Admin role does not grant clinical record access.

## REST API overview

All routes are under `/api`. Browser authentication uses the HTTP-only `clarity_session` cookie; bearer JWT is also accepted for API clients.

| Area | Routes |
| --- | --- |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Patient | `GET/PATCH /patients/me`, `GET /patients/:id`, `GET /patients/:id/timeline`, `GET /patients/:id/trends`, `GET /patients/:id/analyses` |
| Reports | `POST /reports/upload`, `GET /reports`, `GET/DELETE /reports/:id`, `POST /reports/:id/extract`, `PATCH /reports/:id/results` |
| Analysis | `POST /reports/:id/analyze`, `GET /analyses/:id`, `POST /analyses/:id/review` |
| Clinical | `POST /patients/:id/notes`, `POST/GET /patients/:id/follow-ups`, `PATCH /follow-ups/:id`, `GET /doctor/patients` |
| Admin | `GET /admin/users`, `PATCH /admin/users/:id`, `GET /admin/audit-logs` |
| Chat | POST /chat (patient report-specific assistant) |
| Health | GET /health |

Patient-specific routes verify ownership or explicit doctor assignment. Administrators do not inherit clinical access. Login, analysis, and chat endpoints are rate limited. The upload endpoint accepts PDF, PNG, JPEG, and WebP. With OPENAI_API_KEY, the selected PDF/image is sent to the configured provider for extraction. Candidate values require source quotes and patient verification. Without a key, unrelated PDFs are rejected, selectable-text PDFs use conservative local parsing, scanned PDFs are rejected, and photos allow manual transcription only.

## Checks

```bash
npm test
npm run build
npm run check
```

Tests cover conservative result parsing, evidence-checked AI extraction, selected-report chat grounding, range comparisons, source-linked analysis, compatible-unit trends, account authorization, and confirmed image entry. They use the in-memory demo adapter and do not require MongoDB.

## Deploy the complete app on Vercel

The repository is configured as one Vercel project: Vite serves the React client, and `api/[...path].js` sends `/api/*` requests to the Express application as a Vercel Function. The browser and API share one origin, so the HTTP-only session cookie remains same-site.

1. Push the project to GitHub and import that repository in Vercel.
2. Keep the project root as the repository root, the build command as `npm run build`, and the output directory as `dist`.
3. Create a MongoDB Atlas database. Add its connection string as the Vercel `MONGODB_URI` environment variable and allow the Vercel deployment to connect to the Atlas cluster.
4. Add these Vercel Production environment variables:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | MongoDB Atlas connection string |
   | `JWT_SECRET` | A random secret with at least 32 characters |
   | `COOKIE_SECURE` | `true` |
   | `DEMO_MODE` | `false` |
   | `MAX_UPLOAD_MB` | `4` |
   | `VITE_API_BASE` | `/api` |
   | `VITE_MAX_UPLOAD_MB` | `4` |
   | `VITE_EPHEMERAL_REPORT_UPLOADS` | `true` |
   | OPENAI_API_KEY | Optional server-only key. Set it to enable vision extraction for PDFs/images and LLM explanations/chat; without it, labeled deterministic/manual fallbacks are used |

5. Deploy and test `/api/health`, patient registration/login, and a synthetic PDF upload.

For a **Preview-only synthetic demo**, set `DEMO_MODE=true` in Vercel's Preview environment and configure `DEMO_PATIENT_PASSWORD`, `DEMO_DOCTOR_PASSWORD`, and `DEMO_ADMIN_PASSWORD` with separate random values of at least 16 characters. The preview seed uses those stable passwords so different Vercel Function instances agree. Do not enable demo accounts in Production; the API refuses that configuration.

Vercel Functions limit request bodies to 4.5 MB, so this deployment caps each uploaded report at 4 MB. The function processes uploads temporarily and removes the original file; MongoDB stores report metadata and extracted values, not a durable copy of the uploaded PDF/image. Do not upload real patient records. Persistent private report storage needs an object-storage integration, retention controls, and a separate security review.

## Other deployment notes

- Build the client with `npm run build`; the Express process serves `dist/` when `NODE_ENV=production`. This supports a single Node hosting deployment outside Vercel.
- Use HTTPS, a strong secret, `COOKIE_SECURE=true`, `DEMO_MODE=false`, backups, and least-privilege database credentials for hosted deployments.
- Local report uploads use private disk storage under `server/uploads`. A horizontally scaled Node deployment needs private object storage and a retention/deletion policy. Do not expose the uploads directory through a static server.

## Limitations and next steps

- Vision extraction requires a configured provider key and vision-capable model. Candidate OCR values can be misread; patients must verify each source quote and value. Without a key, scanned PDFs and photos do not receive OCR.
- PDF extraction recognizes only a limited list of common lab names and same-line values. It can miss valid tests or layouts, and report-marker detection cannot authenticate the issuing hospital. Always compare the source with a clinician.
- Test-result models currently embed results in reports rather than storing separate `TestResult` documents. This keeps the MVP small; a larger deployment should migrate to a dedicated collection and add conversion tables with validated unit mappings.
- Vision extraction uses the OpenAI Responses API file/image input, and explanation/chat use an OpenAI-compatible chat-completions endpoint. The provider receives the selected report when enabled. The project has no clinically validated emergency threshold system and cannot rule out emergencies.
- Session cookies use `SameSite=Lax`; cross-site production hosting needs explicit CSRF defenses and cookie configuration. Separate Vercel/API deployment needs a configurable API origin.
- Account provisioning for doctors/admins is intentionally not public; add a verified invite or administrative setup flow before real-world use.
- This project is not HIPAA/DPDP compliant or clinically validated and must not be used as a production medical record system without substantial security, legal, privacy, and clinical review.
#   C l a r i t y - H e a l t h  
 
