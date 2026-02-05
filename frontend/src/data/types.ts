export type SyncStatus = 'synced' | 'pending'

export type Entry = {
  id: string
  beans: string
  brewMethod: string
  notes: string
  rating: number
  brewedAt: string
  createdAt: string
  updatedAt: string
  syncStatus?: SyncStatus
}

export type EntryPayload = {
  id?: string
  beans: string
  brew_method: string
  notes: string
  rating: number
  brewed_at: string
}

export type OutboxAction = 'create' | 'update' | 'delete'

export type OutboxItem = {
  id: string
  action: OutboxAction
  entryId: string
  payload?: EntryPayload
  queuedAt: string
}
