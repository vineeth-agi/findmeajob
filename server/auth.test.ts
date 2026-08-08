import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuth, type AuthBindings } from './auth.js'

const validEnv = (overrides: Partial<AuthBindings> = {}): AuthBindings => ({
  AUTH_DB: {},
  BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:4173',
  GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  ...overrides,
})

test('rejects a missing or weak signing secret', () => {
  assert.throws(
    () => createAuth(validEnv({ BETTER_AUTH_SECRET: 'too-short' })),
    /at least 32 characters/,
  )
})

test('rejects plaintext production origins', () => {
  assert.throws(
    () => createAuth(validEnv({ BETTER_AUTH_URL: 'http://findmeajob.example' })),
    /must use HTTPS/,
  )
})

test('rejects base URLs and trusted origins containing paths', () => {
  assert.throws(
    () => createAuth(validEnv({ BETTER_AUTH_URL: 'https://findmeajob.example/login' })),
    /only an origin/,
  )
  assert.throws(
    () => createAuth(validEnv({ BETTER_AUTH_TRUSTED_ORIGINS: 'https://preview.example/auth' })),
    /origins only/,
  )
})

test('requires both Google OAuth credentials', () => {
  assert.throws(
    () => createAuth(validEnv({ GOOGLE_CLIENT_ID: '' })),
    /GOOGLE_CLIENT_ID is required/,
  )
  assert.throws(
    () => createAuth(validEnv({ GOOGLE_CLIENT_SECRET: '' })),
    /GOOGLE_CLIENT_SECRET is required/,
  )
})
