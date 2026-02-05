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
  const response = await fetch('/api/entries')
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
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
  const response = await fetch(`/api/entries/${id}`, { method: 'DELETE' })
  if (response.status === 404) return
  await ensureOk(response)
}
