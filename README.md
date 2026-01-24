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
DATABASE_URL="postgresql://user:pass@host:5432/db"

# Auth
JWT_SECRET="complex-secret"
JWT_ACCESS_EXPIRES_MIN=15
REFRESH_EXPIRES_DAYS=30

# AWS Configuration
AWS_REGION="eu-north-1"
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="..."

# S3
S3_BUCKET_NAME="my-app-files"
CDN_DOMAIN="" # Optional (e.g., cdn.myapp.com)

# SES
SES_SENDER_EMAIL="noreply@myapp.com"
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

- **Refresh Token Rotation**: Every time a Refresh Token is used, it is **revoked** and replaced by a new one. This prevents Token Re-use attacks. If an old token is used, the system detects a potential breach.
- **Device Binding**: Every session is bound to a unique `deviceId`. A Refresh Token is only valid for the device it was issued to.
  - _Logic_: On `login` with a specific `deviceId`, any previous active session for that device is automatically revoked (Single Active Session per Device).
- **Database Hashing**: Refresh tokens are **hashed (Argon2)** before being stored in the database. Even if the database is leaked, attackers cannot hijack sessions.
- **Critical Action Invalidation**: If a user changes their password, all existing sessions issued before that timestamp are instantly invalidated.

#### 3. 2FA & Flows

Critical actions (Password Reset, Email Change) require a short-lived **2FA Token** sent via Email.

- **Scope-Limited**: A generic access token cannot perform these actions.
- **Flow**: User requests action -> Server sends OTP -> User submits OTP -> Server returns scoped 2FA Token.

---

## 📡 API Reference

### 🔐 Auth Module

### 🔐 Auth Module

| Method | Endpoint               | Description             | Headers                                               | Payload                                         |
| :----- | :--------------------- | :---------------------- | :---------------------------------------------------- | :---------------------------------------------- | ------------------- |
| `POST` | `/auth/register`       | Register new user       | -                                                     | `{ "email": "...", "password": "..." }`         |
| `POST` | `/auth/login`          | Login user              | -                                                     | `{ "email": "...", "password": "..." }`         |
| `POST` | `/auth/logout`         | Logout current session  | -                                                     | `{ "refreshToken": "..." }`                     |
| `POST` | `/auth/logout-all`     | Logout all sessions     | `Authorization: Bearer <token>`                       | -                                               |
| `POST` | `/auth/refresh`        | Refresh access token    | -                                                     | `{ "refreshToken": "...", "deviceId": "uuid" }` |
| `POST` | `/auth/2fa`            | Request 2FA OTP         | `Authorization: Bearer <token>`                       | `{ "scope": "verify-email"                      | "reset-password" }` |
| `POST` | `/auth/verify-email`   | Verify Email with 2FA   | `Authorization: Bearer <token>`, `x-2fa-token: <otp>` | -                                               |
| `POST` | `/auth/reset-password` | Reset Password with 2FA | `Authorization: Bearer <token>`, `x-2fa-token: <otp>` | `{ "newPassword": "new-strong-password" }`      |

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
