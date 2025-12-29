# OAuth Implementation Plan

**Goal:** Add OAuth2 authentication with Google and GitHub providers, using JWT tokens for session management.

**Design:** [thoughts/shared/designs/2024-12-26-auth-design.md](../designs/2024-12-26-auth-design.md)

---

## Overview

Implement secure authentication using OAuth2 for social login and JWT tokens for API authentication. Support Google and GitHub as initial providers with extensible architecture for adding more.

## Approach

1. Use Passport.js for OAuth abstraction
2. Generate JWT tokens after successful OAuth callback
3. Store tokens in httpOnly cookies for web clients
4. Implement refresh token rotation for long-lived sessions

---

## Phase 1: OAuth Provider Setup

### Task 1.1: Install Dependencies

```bash
npm install passport passport-google-oauth20 passport-github2 jsonwebtoken
npm install -D @types/passport @types/jsonwebtoken
```

### Task 1.2: Configure Google OAuth

**Files:** `src/auth/strategies/google.ts`

Create Google OAuth strategy with proper scopes for email and profile.

### Task 1.3: Configure GitHub OAuth

**Files:** `src/auth/strategies/github.ts`

Create GitHub OAuth strategy.

---

## Phase 2: JWT Token Management

### Task 2.1: Token Generation

**Files:** `src/auth/jwt.ts`

- Generate access tokens (15 min expiry)
- Generate refresh tokens (7 day expiry)
- Use RS256 algorithm

### Task 2.2: Token Refresh

**Files:** `src/auth/refresh.ts`

- Validate refresh token
- Rotate refresh token on use
- Blacklist old tokens

---

## Phase 3: Integration

### Task 3.1: Auth Middleware

**Files:** `src/middleware/auth.ts`

- Extract token from cookie or Authorization header
- Validate and decode token
- Attach user to request

### Task 3.2: Protected Routes

**Files:** `src/routes/api.ts`

- Add auth middleware to protected routes
- Return 401 for invalid/missing tokens
