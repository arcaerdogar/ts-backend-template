# Enterprise Backend Template (Node.js + TypeScript + AWS)

## 📖 Introduction

A scalable, production-ready backend template designed for modern cloud native applications. Built with **Node.js, Express, TypeScript, and Prisma**, and pre-configured with essential AWS integrations (S3, SES).

### Key Features

- **Language**: TypeScript (Strict Mode)
- **Framework**: Express.js (v5)
- **Database**: PostgreSQL with Prisma ORM
- **Security**:
  - **JWT Auth**: Dual token system (Access + Refresh).
  - **2FA**: OTP validation via Email.
  - **Secure Cookies**: HTTP-only storage.
  - **Argon2**: Industry-standard password hashing.

---

## 🛠️ Setup and Installation

### Prerequisites

- Node.js (v20+)
- PostgreSQL Database
- AWS Account (S3 Bucket + SES Verified Identity)

### 1. Clone & Install

```bash
git clone https://github.com/arcaerdogar/ts-backend-template.git
cd backend-template
npm install
npm run prisma:gen
```

### 2. Configure Environment

Copy `env.example` to `.env` and fill in the values:

```env
PORT=3000

# Logging: debug | info | warn | error | silent (default info)
LOG_LEVEL=info

# CORS
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"

DATABASE_URL="postgresql://user:pass@host:5432/db"

# Auth
JWT_SECRET="complex-secret"
JWT_ACCESS_EXPIRES_MIN=15
JWT_TWO_FACTOR_EXPIRES_MIN=10
JWT_TWO_FACTOR_SECRET="another-complex-secret"
JWT_ROOT_EXPIRES_MIN=60          # Optional (default 60). Root admin token lifetime.
REFRESH_EXPIRES_DAYS=30
REFRESH_TOKEN_HASH_SECRET="another-long-random-secret"

# Root Admin Panel
ADMIN_EMAIL="root@myapp.com"
ADMIN_PASSWORD="strong-root-password"
ROOT_ACCESS_COOKIE_NAME="root_access"   # Optional
COOKIE_SECURE=false                       # Optional (auto true in production)

# AWS Configuration
AWS_REGION="eu-north-1"
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="..."

# S3
S3_BUCKET_NAME="my-app-files"
CDN_DOMAIN="" # Optional (e.g., cdn.myapp.com)

# SES
SES_SENDER_EMAIL="noreply@myapp.com"

# Redis (rate limiting, 2FA denylist, sessions, BullMQ)
# Local dev: docker-compose ships a redis on localhost:6379.
# Inside docker-compose the app auto-connects to redis://redis:6379.
REDIS_URL="redis://localhost:6379"
```

### 3. Database Migration

```bash
npm run prisma:mig
```

### 4. Start Server

```bash
npm run dev
```

---

## 🧪 Testing

Tests run with **Vitest** (unit) + **Supertest** (HTTP integration) against **isolated Docker containers** — a throwaway Postgres + Redis defined in `docker-compose.test.yml`. Your real database is never touched. AWS SES is mocked with `aws-sdk-client-mock`, so no emails are sent.

```bash
# 1. Spin up the test Postgres (:5433) + Redis (:6381) and wait for health
npm run test:db:up

# 2. Run the suite (globalSetup pushes the schema to the test DB)
npm test           # single run
npm run test:watch # watch mode

# 3. Tear down + wipe volumes when done
npm run test:db:down
```

- **Config**: `vitest.config.ts`, env in `.env.test` (fake AWS/JWT secrets).
- **Layout**: `tests/unit/` (pure functions) and `tests/integration/` (full `/auth`, `/root`, `/users` flows incl. account suspension/locking from issue #8).
- The DB is truncated and Redis flushed before every test (`tests/setup.ts`), so tests are isolated and order-independent.

---

## 📝 Logging & Observability

Structured JSON logging via **pino** + **pino-http**. Every request gets a **correlation id** (`X-Request-Id` — reused if the client sends one, generated otherwise, echoed back in the response header). The id is carried through all layers via `AsyncLocalStorage`, so service-level logs and `AuthEvent` rows (`meta.requestId`) all share it — filter by one id to trace a whole request.

- **Output**: stdout only (12-factor). Dev uses `pino-pretty`; prod emits raw JSON. In Docker the configured `json-file` driver captures + rotates it. Ship stdout to an aggregator in production — no code change.
- **Levels**: `LOG_LEVEL` env (`debug`…`error`, or `silent` in tests).
- This is **operational** logging; durable, queryable login/security history lives in the `AuthEvent` table (see [ADR 0001](docs/adr/0001-session-storage-and-audit.md)).

---

## 🏗️ Project Structure and Architecture

### Directory Structure

```
src/
├── config/             # Env variables, DB connection
├── modules/            # Domain Modules
│   ├── auth/           # Login, Register, 2FA
│   ├── upload/         # FileController, Routes, Utils
│   └── common/         # Shared middlewares
├── services/           # External Services
│   ├── aws/            # AWS Client Config
│   ├── storage/        # S3 Implementation
│   ├── mail-service/   # SES Implementation
└── scripts/            # Utility scripts
```

### Architecture Highlights

The project follows a **Modular Architecture**. Each feature (Auth, Upload) is self-contained with its own routes, controller, and DTOs. Cross-cutting concerns like storage and mail are abstracted as **Services**.

---

## ☁️ AWS Services

This template comes with powerful, pre-configured AWS integrations.

### 📧 Mail Service (AWS SES)

An abstraction layer over AWS Simple Email Service (SES) for reliable email delivery.

- **Transactional Emails**: Ready-to-use methods for `verification`, `password-reset`, and `email-change`.
- **Templating**: Handlebars-based HTML templates support.
- **Provider**: AWS SES.

### 🗄️ File Storage Service (AWS S3)

A high-performance file management system designed to handle uploads without creating a bottleneck on your server.

#### Features

1.  **Presigned Uploads**: Serverless-style direct uploads to S3.
2.  **Temp Folder Strategy**:
    - Uploads start in `temp/`.
    - Confirmed files move to `final/`.
    - Unconfirmed files represent no database bloat and are auto-cleaned by S3.
3.  **Private File Access**: Secure access to private buckets via **Presigned Download URLs**.
4.  **CDN Support**: Integrated CloudFront support for public files.

#### Upload Flow (Hybrid Strategy)

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant AWS S3

    Client->>Server: POST /upload/init
    Server-->>Client: Presigned URL
    Client->>AWS S3: PUT /file (to temp/)
    Client->>Server: POST /upload/confirm
    Server->>AWS S3: Move File (temp/ -> final/)
    Server->>DB: Save Record
```

#### Verification

To verify S3 integration independently:

```bash
npx tsx src/scripts/verify-s3.ts
```

---

### 🔐 Authentication & Session Management

The project implements a robust **Dual Token Architecture** (Access + Refresh) designed for security and multi-device support.

#### 1. Token Architecture

| Token Type        | Storage        | Expiration  | Purpose                                                    |
| :---------------- | :------------- | :---------- | :--------------------------------------------------------- |
| **Access Token**  | Client Memory  | Short (15m) | API Authorization (Bearer Header). Stateless JWT.          |
| **Refresh Token** | Secure Storage | Long (30d)  | Obtaining new Access Tokens. Opaque string (JTI + Secret). |

#### 2. Session Lifecycle & Security

Sessions live in **Redis** (TTL-based, AOF-durable) — not Postgres. See [ADR 0001](docs/adr/0001-session-storage-and-audit.md) for the full design.

- **Refresh Token Rotation**: Every time a Refresh Token is used it is **revoked** and replaced by a new one (atomic, via a Redis Lua script). Replaying a rotated token is detected as **reuse** and revokes the whole session family for that user.
- **Device Binding**: Every session is bound to a unique `deviceId`. A Refresh Token is only valid for the device it was issued to. On `login` with a given `deviceId`, the previous active session for that device is revoked (Single Active Session per Device).
- **Token Hashing**: Only the **HMAC-SHA256** hash of the token is stored; the raw secret never touches storage. Knowing a `jti` without its secret is useless.
- **Critical Action Invalidation**: Changing the password (or suspending the account) **eagerly revokes all sessions** — immediate global logout.
- **Audit Trail**: Logins, logouts, failed attempts, lockouts, suspensions and reuse-detections are written to an append-only **`AuthEvent`** table in Postgres for queryable history (Redis holds only live state).

#### 3. 2FA & Flows

Critical actions (Password Reset, Email Change) require a short-lived **2FA Token** sent via Email.

- **Scope-Limited**: A generic access token cannot perform these actions.
- **Flow**: User requests action -> Server sends OTP -> User submits OTP -> Server returns scoped 2FA Token.

---

## 📡 API Reference

### 🔐 Auth Module

| Method | Endpoint               | Description             | Headers                                               | Payload                                         |
| :----- | :--------------------- | :---------------------- | :---------------------------------------------------- | :---------------------------------------------- | ------------------- |
| `POST` | `/auth/register`       | Register new user       | -                                                     | `{ "email", "password", "firstName", "lastName" }` (profile is created in the same transaction) |
| `POST` | `/auth/login`          | Login user              | -                                                     | `{ "email": "...", "password": "..." }`         |
| `POST` | `/auth/logout`         | Logout current session  | -                                                     | `{ "refreshToken": "..." }`                     |
| `POST` | `/auth/logout-all`     | Logout all sessions     | `Authorization: Bearer <token>`                       | -                                               |
| `POST` | `/auth/refresh`        | Refresh access token    | -                                                     | `{ "refreshToken": "...", "deviceId": "uuid" }` |
| `POST` | `/auth/2fa`            | Request 2FA OTP         | `Authorization: Bearer <token>`                       | `{ "scope": "verify-email" \| "reset-password" \| "change-email", "newEmail": "..." }` (`newEmail` required when `scope` is `"change-email"`) |
| `POST` | `/auth/verify-email`   | Verify Email with 2FA   | `Authorization: Bearer <token>`, `x-2fa-token: <otp>` | -                                               |
| `POST` | `/auth/reset-password` | Reset Password with 2FA | `Authorization: Bearer <token>`, `x-2fa-token: <otp>` | `{ "newPassword": "new-strong-password" }`      |
| `POST` | `/auth/change-email`   | Change Email with 2FA   | `Authorization: Bearer <token>`, `x-2fa-token: <otp>` | -                                               |

### 👤 Me / Profile Module

Every user has a mandatory 1:1 **Profile** (firstName, lastName, optional photo), created atomically at register. The profile photo is not a raw URL — it references a `File` entity (see Upload Module), so the standard presigned-upload flow + DB abstraction applies.

| Method  | Endpoint            | Headers                         | Payload                          | Description |
| :------ | :------------------ | :------------------------------ | :------------------------------- | :---------- |
| `GET`   | `/me`               | `Authorization: Bearer <token>` | -                                | Self info + profile + active sessions |
| `PATCH` | `/me/profile`       | `Authorization: Bearer <token>` | `{ "firstName"?, "lastName"? }`  | Update profile fields (≥1 required) |
| `PUT`   | `/me/profile/photo` | `Authorization: Bearer <token>` | `{ "fileId": "uuid" }`           | Link a confirmed `PROFILE_PHOTO` File as the avatar; previous photo is soft-deleted |

> **Photo flow:** `POST /files/init` (purpose `PROFILE_PHOTO`) → `PUT` to S3 → `POST /files/confirm` (creates the `File`) → `PUT /me/profile/photo` with the returned `file.id`. The avatar URL returned by `/me` is built via the public/CDN URL; switch to a presigned download URL if your bucket is private.

### 👑 Roles & Admin

The template ships with a two-tier admin model:

- **Root Admin** — a single, env-bootstrapped super user (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Not stored in the DB. Logs in to receive an HttpOnly `root_access` cookie (token is also returned in the body for non-browser clients). Its sole purpose is granting/revoking the `SYSTEM_ADMIN` role.
- **System Admin** — a regular user who has been granted the `SYSTEM_ADMIN` role (via the `HasRole` table) by the Root Admin. Authenticates with a normal access token and can manage end users (list, inspect, suspend).

Guards: `rootAuthGuard` (root only), `adminRouteAuthGuard` (access JWT **or** root JWT), and `roleAuthGuard([RoleName.SYSTEM_ADMIN], { allowRoot: true })`.

#### 🪪 Root Module (`/root`)

| Method | Endpoint                     | Auth        | Payload                                  | Description                          |
| :----- | :--------------------------- | :---------- | :--------------------------------------- | :----------------------------------- |
| `POST` | `/root/login`                | -           | `{ "email": "...", "password": "..." }`  | Login as root (sets `root_access` cookie) |
| `POST` | `/root/logout`               | -           | -                                        | Clear root cookie                    |
| `POST` | `/root/manage-system-admin`  | Root cookie/Bearer | `{ "userId": "uuid", "assign": true }` | Grant (`true`) / revoke (`false`) `SYSTEM_ADMIN` |

#### 👥 Admin User Module (`/users`)

Requires `SYSTEM_ADMIN` role (or root).

| Method  | Endpoint              | Payload                  | Description                                   |
| :------ | :-------------------- | :----------------------- | :-------------------------------------------- |
| `GET`   | `/users`              | query: `page,limit,q`    | Paginated user list with email search         |
| `GET`   | `/users/:id`          | -                        | User detail (roles + active sessions)         |
| `PATCH` | `/users/:id/suspend`  | `{ "suspended": true }`  | Suspend/unsuspend. Suspending revokes all refresh sessions. |

> **Account protection:** `login` now rejects suspended accounts (`ACCOUNT_SUSPENDED`) and temporarily locks accounts after 5 consecutive failed attempts for 15 minutes (`ACCOUNT_LOCKED`).

### 📂 Upload Module

#### 1. Initialize Upload

Request a secure upload slot.

- **URL**: `/upload/init`
- **Body**:
  ```json
  {
    "fileName": "avatar.jpg",
    "mimeType": "image/jpeg",
    "size": 10240,
    "purpose": "PROFILE_PHOTO",
    "checksum": "md5-hash"
  }
  ```
- **Response**:
  ```json
  {
    "url": "https://s3.aws.com/...",
    "key": "temp/profile-photos/..."
  }
  ```

#### 2. Confirm Upload

Finalize the upload, verify integrity, and move file to permanent storage.

- **URL**: `/upload/confirm`
- **Body**:
  ```json
  {
    "key": "temp/profile-photos/...",
    "checksum": "md5-hash"
  }
  ```
- **Response**:
  ```json
  {
    "file": { "id": "...", "url": "..." }
  }
  ```

#### 3. Download Private File

Get a temporary access link for a private file.

- **URL**: `/upload/download?key=documents/id-card.pdf`
- **Response**:
  ```json
  {
    "url": "https://s3.aws.com/signed-url..."
  }
  ```
