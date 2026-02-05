import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Coffee,
  Loader2,
  Pencil,
  Trash2,
  WifiOff,
} from 'lucide-react'
import type { Entry, EntryPayload, OutboxItem } from './data/types'
import {
  clearEntries,
  deleteEntry,
  deleteOutboxItem,
  getAllEntries,
  getOutboxItems,
  putEntries,
  putEntry,
  putOutboxItem,
} from './data/storage'
import {
  createEntry,
  deleteEntry as deleteEntryRemote,
  fetchEntries,
  updateEntry,
} from './data/api'

type Locale = 'en' | 'ru'

const translations = {
  en: {
    appTitle: 'Coffee Log',
    syncing: 'Syncing',
    offline: 'Offline',
    allSynced: 'All synced',
    queued: 'queued',
    beans: 'Beans',
    beansPlaceholder: 'Ethiopia Yirgacheffe',
    brewMethod: 'Brew Method',
    tapToAutofill: 'Tap to autofill',
    brewMethodPlaceholder: 'Or type your own...',
    brewTime: 'Brew Time',
    rating: 'Rating',
    notes: 'Notes',
    notesPlaceholder: 'Tasting notes, brew ratio, thoughts...',
    requiredError: 'Beans and brew method are required.',
    logEntry: 'Log Entry',
    updateEntry: 'Update Entry',
    cancel: 'Cancel',
    recentBrews: 'Recent Brews',
    upToDate: 'Up to date',
    emptyState: 'No entries yet. Start with your first brew.',
    editEntry: 'Edit entry',
    deleteEntry: 'Delete entry',
  },
  ru: {
    appTitle: 'Кофейный журнал',
    syncing: 'Синхронизация',
    offline: 'Офлайн',
    allSynced: 'Все синхронизировано',
    queued: 'в очереди',
    beans: 'Зерна',
    beansPlaceholder: 'Эфиопия Иргачефф',
    brewMethod: 'Метод заваривания',
    tapToAutofill: 'Нажмите для выбора',
    brewMethodPlaceholder: 'Или введите вручную...',
    brewTime: 'Время заваривания',
    rating: 'Оценка',
    notes: 'Заметки',
    notesPlaceholder: 'Вкус, рецепт, впечатления...',
    requiredError: 'Введите зерна и метод заваривания.',
    logEntry: 'Сохранить',
    updateEntry: 'Обновить',
    cancel: 'Отмена',
    recentBrews: 'Недавние записи',
    upToDate: 'Актуально',
    emptyState: 'Пока нет записей. Добавьте первую.',
    editEntry: 'Редактировать запись',
    deleteEntry: 'Удалить запись',
  },
} as const

const brewPresets = [
  { id: 'espresso', en: 'Espresso', ru: 'Эспрессо' },
  { id: 'pour_over', en: 'Pour Over', ru: 'Пуровер' },
  { id: 'french_press', en: 'French Press', ru: 'Френч-пресс' },
  { id: 'aeropress', en: 'AeroPress', ru: 'Аэропресс' },
  { id: 'cold_brew', en: 'Cold Brew', ru: 'Колд брю' },
  { id: 'drip', en: 'Drip', ru: 'Фильтр' },
]

const createId = () => {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : null
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return `local-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

const toPayload = (entry: Entry): EntryPayload => ({
  id: entry.id,
  beans: entry.beans,
  brew_method: entry.brewMethod,
  notes: entry.notes,
  rating: entry.rating,
  brewed_at: entry.brewedAt,
})

const sortEntries = (list: Entry[]) =>
  [...list].sort(
    (a, b) => new Date(b.brewedAt).getTime() - new Date(a.brewedAt).getTime()
  )

const toLocalInput = (iso: string) => {
  const date = new Date(iso)
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

const fromLocalInput = (value: string) => {
  const date = new Date(value)
  return date.toISOString()
}

const formatWhen = (iso: string) => {
  const date = new Date(iso)
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const emptyForm = () => ({
  beans: '',
  brewMethod: '',
  notes: '',
  rating: 0,
  brewedAt: toLocalInput(new Date().toISOString()),
})

export default function CoffeeLog() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en'
    const stored = window.localStorage.getItem('coffee_log_locale')
    return stored === 'ru' ? 'ru' : 'en'
  })
  const [entries, setEntries] = useState<Entry[]>([])
  const [outbox, setOutbox] = useState<OutboxItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'offline'>(
    'idle'
  )
  const [error, setError] = useState<string | null>(null)
  const text = translations[locale]

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('coffee_log_locale', locale)
    }
  }, [locale])

  const pendingCount = useMemo(
    () => entries.filter((entry) => entry.syncStatus === 'pending').length,
    [entries]
  )

  const refreshOutbox = useCallback(async () => {
    const items = await getOutboxItems()
    items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    setOutbox(items)
    return items
  }, [])

  const loadLocal = useCallback(async () => {
    const localEntries = await getAllEntries()
    setEntries(sortEntries(localEntries))
  }, [])

  const syncFromServer = useCallback(async () => {
    const localEntries = await getAllEntries()
    const pending = new Map(
      localEntries
        .filter((entry) => entry.syncStatus === 'pending')
        .map((entry) => [entry.id, entry])
    )
    const remoteEntries = await fetchEntries()
    const merged: Entry[] = []

    remoteEntries.forEach((entry) => {
      const pendingEntry = pending.get(entry.id)
      merged.push(pendingEntry ?? entry)
    })

    pending.forEach((entry) => {
      if (!merged.find((item) => item.id === entry.id)) {
        merged.push(entry)
      }
    })

    await clearEntries()
    await putEntries(merged)
    setEntries(sortEntries(merged))
  }, [])

  const processOutbox = useCallback(async () => {
    const items = await refreshOutbox()
    for (const item of items) {
      try {
        if (item.action === 'create' && item.payload) {
          const created = await createEntry(item.payload)
          await putEntry({ ...created, syncStatus: 'synced' })
        }
        if (item.action === 'update' && item.payload) {
          const updated = await updateEntry(item.entryId, item.payload)
          await putEntry({ ...updated, syncStatus: 'synced' })
        }
        if (item.action === 'delete') {
          await deleteEntryRemote(item.entryId)
        }
        await deleteOutboxItem(item.id)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to sync changes'
        setError(message)
        break
      }
    }
  }, [refreshOutbox])

  const runSync = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncState('offline')
      return
    }
    setSyncState('syncing')
    setError(null)
    try {
      await processOutbox()
      await syncFromServer()
      await refreshOutbox()
      setSyncState('idle')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to sync changes'
      setError(message)
      setSyncState('offline')
    }
  }, [processOutbox, refreshOutbox, syncFromServer])

  useEffect(() => {
    loadLocal().then(refreshOutbox).then(runSync)
  }, [loadLocal, refreshOutbox, runSync])

  useEffect(() => {
    const handleOnline = () => runSync()
    const handleOffline = () => setSyncState('offline')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runSync])

  const startEdit = (entry: Entry) => {
    setEditingId(entry.id)
    setForm({
      beans: entry.beans,
      brewMethod: entry.brewMethod,
      notes: entry.notes,
      rating: entry.rating,
      brewedAt: toLocalInput(entry.brewedAt),
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(emptyForm())
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const payloadBase = {
      beans: form.beans.trim(),
      brewMethod: form.brewMethod.trim(),
      notes: form.notes.trim(),
      rating: form.rating,
      brewedAt: fromLocalInput(form.brewedAt),
    }

    if (!payloadBase.beans || !payloadBase.brewMethod) {
      setError(text.requiredError)
      return
    }

    if (editingId) {
      const previous = entries.find((entry) => entry.id === editingId)
      if (!previous) return
      const updated: Entry = {
        ...previous,
        ...payloadBase,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      }
      setEntries(sortEntries(entries.map((entry) => (entry.id === editingId ? updated : entry))))
      await putEntry(updated)
      await putOutboxItem({
        id: createId(),
        action: 'update',
        entryId: editingId,
        payload: toPayload(updated),
        queuedAt: new Date().toISOString(),
      })
      resetForm()
      await refreshOutbox()
      await runSync()
      return
    }

    const now = new Date().toISOString()
    const newEntry: Entry = {
      id: createId(),
      beans: payloadBase.beans,
      brewMethod: payloadBase.brewMethod,
      notes: payloadBase.notes,
      rating: payloadBase.rating,
      brewedAt: payloadBase.brewedAt,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
    }
    setEntries(sortEntries([newEntry, ...entries]))
    await putEntry(newEntry)
    await putOutboxItem({
      id: createId(),
      action: 'create',
      entryId: newEntry.id,
      payload: toPayload(newEntry),
      queuedAt: now,
    })
    resetForm()
    await refreshOutbox()
    await runSync()
  }

  const handleDelete = async (entry: Entry) => {
    setError(null)
    setEntries(entries.filter((item) => item.id !== entry.id))
    await deleteEntry(entry.id)
    await putOutboxItem({
      id: createId(),
      action: 'delete',
      entryId: entry.id,
      queuedAt: new Date().toISOString(),
    })
    await refreshOutbox()
    await runSync()
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#2C2C2C] font-sans flex justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#E5E0D8] shadow-sm rounded-xl overflow-hidden">
        <div className="bg-[#2C2C2C] text-[#FDFBF7] p-4 flex items-center justify-between">
          <h1 className="text-xl font-serif font-semibold tracking-wide flex items-center gap-2">
            <Coffee size={20} />
            {text.appTitle}
          </h1>
          <div className="flex items-center gap-2 text-xs">
            {syncState === 'syncing' && (
              <span className="flex items-center gap-1 text-stone-300">
                <Loader2 size={12} className="animate-spin" />
                {text.syncing}
              </span>
            )}
            {syncState === 'offline' && (
              <span className="flex items-center gap-1 text-amber-300">
                <WifiOff size={12} />
                {text.offline}
              </span>
            )}
            {syncState === 'idle' && (
              <span className="flex items-center gap-1 text-emerald-300">
                <CheckCircle2 size={12} />
                {pendingCount > 0
                  ? `${pendingCount} ${text.queued}`
                  : text.allSynced}
              </span>
            )}
            <div className="hidden sm:flex items-center gap-1 ml-2 border border-white/30 rounded-full px-1 py-0.5 text-[11px] uppercase tracking-widest">
              {(['en', 'ru'] as Locale[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLocale(option)}
                  className={`px-2 py-0.5 rounded-full ${
                    locale === option ? 'bg-white text-[#2C2C2C]' : 'text-white/70'
                  }`}
                  aria-pressed={locale === option}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {text.beans}
            </label>
            <input
              type="text"
              placeholder={text.beansPlaceholder}
              value={form.beans}
              onChange={(event) =>
                setForm({ ...form, beans: event.target.value })
              }
              className="w-full bg-white border-b-2 border-[#E5E0D8] px-0 py-2 focus:outline-none focus:border-[#8B5A2B] placeholder-stone-400 text-lg font-serif text-[#2C2C2C]"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-500">
                {text.brewMethod}
              </label>
              <span className="text-[11px] uppercase tracking-widest text-stone-400">
                {text.tapToAutofill}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {brewPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      brewMethod: preset[locale],
                    })
                  }
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    form.brewMethod === preset[locale]
                      ? 'bg-[#2C2C2C] text-white border-[#2C2C2C]'
                      : 'bg-[#FAF9F6] text-stone-600 border-[#E5E0D8] hover:text-stone-800'
                  } active:scale-95`}
                >
                  {preset[locale]}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder={text.brewMethodPlaceholder}
              value={form.brewMethod}
              onChange={(event) =>
                setForm({ ...form, brewMethod: event.target.value })
              }
              className="w-full bg-[#FAF9F6] border border-[#E5E0D8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#8B5A2B]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {text.brewTime}
            </label>
            <input
              type="datetime-local"
              value={form.brewedAt}
              onChange={(event) =>
                setForm({ ...form, brewedAt: event.target.value })
              }
              className="w-full text-sm text-stone-500 bg-transparent border border-[#E5E0D8] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#8B5A2B]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {text.rating}
            </label>
            <div className="flex gap-2 justify-start py-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setForm({ ...form, rating: star })}
                  className="focus:outline-none transition-transform active:scale-110"
                >
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill={star <= form.rating ? '#8B5A2B' : 'none'}
                    stroke={star <= form.rating ? '#8B5A2B' : '#D1CCC0'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="12 2 15 8.5 22 9.3 17 14 18.2 21 12 17.6 5.8 21 7 14 2 9.3 9 8.5 12 2" />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {text.notes}
            </label>
            <textarea
              placeholder={text.notesPlaceholder}
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              className="w-full bg-[#FAF9F6] border border-[#E5E0D8] rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#8B5A2B]"
            ></textarea>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 bg-[#2C2C2C] text-[#FDFBF7] py-3 rounded-lg font-bold text-base shadow-lg active:scale-[0.98] transition-all"
            >
              {editingId ? text.updateEntry : text.logEntry}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-3 rounded-lg border border-[#E5E0D8] text-sm font-semibold text-stone-500 hover:text-stone-700"
              >
                {text.cancel}
              </button>
            )}
          </div>
        </form>

        <div className="border-t border-[#E5E0D8] px-5 py-4 bg-[#FAF9F6]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-500">
              {text.recentBrews}
            </h2>
            <span className="text-xs text-stone-400">
              {outbox.length > 0
                ? `${outbox.length} ${text.queued}`
                : text.upToDate}
            </span>
          </div>

          {entries.length === 0 ? (
            <div className="text-sm text-stone-500 bg-white border border-dashed border-[#E5E0D8] rounded-lg p-4 text-center">
              {text.emptyState}
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-white border border-[#E5E0D8] rounded-lg p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#2C2C2C]">
                        {entry.beans}
                      </div>
                      <div className="text-xs text-stone-500 mt-1">
                        {entry.brewMethod} · {formatWhen(entry.brewedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        className="p-2.5 min-w-[40px] min-h-[40px] rounded-full border border-[#E5E0D8] text-stone-500 hover:text-[#8B5A2B]"
                        aria-label={text.editEntry}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(entry)}
                        className="p-2.5 min-w-[40px] min-h-[40px] rounded-full border border-[#E5E0D8] text-stone-500 hover:text-red-600"
                        aria-label={text.deleteEntry}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 mt-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span key={star} className="text-xs">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill={star <= entry.rating ? '#8B5A2B' : 'none'}
                          stroke={star <= entry.rating ? '#8B5A2B' : '#D1CCC0'}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polygon points="12 2 15 8.5 22 9.3 17 14 18.2 21 12 17.6 5.8 21 7 14 2 9.3 9 8.5 12 2" />
                        </svg>
                      </span>
                    ))}
                    {entry.syncStatus === 'pending' && (
                      <span className="ml-2 text-[11px] uppercase tracking-widest text-amber-500">
                        {text.queued}
                      </span>
                    )}
                  </div>

                  {entry.notes && (
                    <p className="mt-2 text-sm text-stone-600">
                      {entry.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
