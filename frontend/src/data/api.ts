import type { Entry, EntryPayload } from './types'

type ServerEntry = {
  id: string
  beans: string
  brew_method: string
  notes: string
  rating: number
  brewed_at: string
  created_at: string
  updated_at: string
}

const TOKEN_KEY = 'coffee_log_token'

export const getAuthToken = () => {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export const setAuthToken = (token: string | null) => {
  if (typeof window === 'undefined') return
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(TOKEN_KEY)
  }
}

const authHeaders = () => {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const parseJSON = async <T>(response: Response): Promise<T> => {
  const data = await response.json()
  return data as T
}

const ensureOk = async (response: Response) => {
  if (response.ok) return response
  let message = `Request failed (${response.status})`
  try {
    const data = await response.json()
    if (typeof data?.error === 'string') message = data.error
  } catch {
    // ignore
  }
  throw new Error(message)
}

export const fetchEntries = async (): Promise<Entry[]> => {
  const response = await fetch('/api/entries', {
    headers: { ...authHeaders() },
  })
  await ensureOk(response)
  const data = await parseJSON<ServerEntry[]>(response)
  return data.map((entry) => ({
    id: entry.id,
    beans: entry.beans,
    brewMethod: entry.brew_method,
    notes: entry.notes,
    rating: entry.rating,
    brewedAt: entry.brewed_at,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    syncStatus: 'synced',
  }))
}

export const createEntry = async (payload: EntryPayload): Promise<Entry> => {
  const response = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  await ensureOk(response)
  const entry = await parseJSON<ServerEntry>(response)
  return {
    id: entry.id,
    beans: entry.beans,
    brewMethod: entry.brew_method,
    notes: entry.notes,
    rating: entry.rating,
    brewedAt: entry.brewed_at,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    syncStatus: 'synced',
  }
}

export const updateEntry = async (
  id: string,
  payload: EntryPayload
): Promise<Entry> => {
  const response = await fetch(`/api/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  await ensureOk(response)
  const entry = await parseJSON<ServerEntry>(response)
  return {
    id: entry.id,
    beans: entry.beans,
    brewMethod: entry.brew_method,
    notes: entry.notes,
    rating: entry.rating,
    brewedAt: entry.brewed_at,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    syncStatus: 'synced',
  }
}

export const deleteEntry = async (id: string): Promise<void> => {
  const response = await fetch(`/api/entries/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (response.status === 404) return
  await ensureOk(response)
}

export const registerUser = async (
  email: string,
  password: string
): Promise<{ token: string }> => {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  await ensureOk(response)
  const data = await parseJSON<{ token: string }>(response)
  return data
}

export const loginUser = async (
  email: string,
  password: string
): Promise<{ token: string }> => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  await ensureOk(response)
  const data = await parseJSON<{ token: string }>(response)
  return data
}

export const getPushConfig = async (): Promise<{
  publicKey?: string
  subject?: string
}> => {
  const response = await fetch('/api/push/config')
  await ensureOk(response)
  return parseJSON<{ publicKey?: string; subject?: string }>(response)
}

export const subscribePush = async (subscription: PushSubscription) => {
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(subscription),
  })
  await ensureOk(response)
}

export const sendTestPush = async () => {
  const response = await fetch('/api/push/test', {
    method: 'POST',
    headers: { ...authHeaders() },
  })
  await ensureOk(response)
}
