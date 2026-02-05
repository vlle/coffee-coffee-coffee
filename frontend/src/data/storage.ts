import type { Entry, OutboxItem } from './types'

const DB_NAME = 'coffee-log'
const DB_VERSION = 1
const ENTRY_STORE = 'entries'
const OUTBOX_STORE = 'outbox'

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        db.createObjectStore(ENTRY_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export const getAllEntries = async (): Promise<Entry[]> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readonly')
    const store = tx.objectStore(ENTRY_STORE)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as Entry[])
    request.onerror = () => reject(request.error)
  })
}

export const putEntry = async (entry: Entry): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readwrite')
    const store = tx.objectStore(ENTRY_STORE)
    store.put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const putEntries = async (entries: Entry[]): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readwrite')
    const store = tx.objectStore(ENTRY_STORE)
    entries.forEach((entry) => store.put(entry))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const deleteEntry = async (id: string): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readwrite')
    const store = tx.objectStore(ENTRY_STORE)
    store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const clearEntries = async (): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readwrite')
    const store = tx.objectStore(ENTRY_STORE)
    store.clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const getOutboxItems = async (): Promise<OutboxItem[]> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly')
    const store = tx.objectStore(OUTBOX_STORE)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as OutboxItem[])
    request.onerror = () => reject(request.error)
  })
}

export const putOutboxItem = async (item: OutboxItem): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite')
    const store = tx.objectStore(OUTBOX_STORE)
    store.put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const deleteOutboxItem = async (id: string): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite')
    const store = tx.objectStore(OUTBOX_STORE)
    store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
