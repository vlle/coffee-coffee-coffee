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
  clearOutbox,
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
  getAuthToken,
  getPushConfig,
  updateEntry,
  loginUser,
  registerUser,
  sendTestPush,
  setAuthToken,
  subscribePush,
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
    signIn: 'Sign In',
    createAccount: 'Create Account',
    signingIn: 'Working...',
    working: 'Working...',
    signOut: 'Sign out',
    emailPlaceholder: 'Email',
    passwordPlaceholder: 'Password (min 8 chars)',
    notifications: 'Notifications',
    notificationsEnabled: 'Enabled',
    notificationsUnavailable: 'Unavailable in this browser',
    notificationsDenied: 'Permission denied',
    notificationsHint: 'Enable brew alerts',
    enable: 'Enable',
    test: 'Test',
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
    signIn: 'Войти',
    createAccount: 'Создать аккаунт',
    signingIn: 'Подождите...',
    working: 'Подождите...',
    signOut: 'Выйти',
    emailPlaceholder: 'Почта',
    passwordPlaceholder: 'Пароль (минимум 8)',
    notifications: 'Уведомления',
    notificationsEnabled: 'Включены',
    notificationsUnavailable: 'Недоступны в браузере',
    notificationsDenied: 'Доступ запрещен',
    notificationsHint: 'Включите напоминания',
    enable: 'Включить',
    test: 'Тест',
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
  const [token, setToken] = useState<string | null>(() => getAuthToken())
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authLoading, setAuthLoading] = useState(false)
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
  const [pushStatus, setPushStatus] = useState<
    'idle' | 'enabled' | 'unsupported' | 'denied' | 'loading'
  >('idle')
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
    if (!token) return
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
  }, [refreshOutbox, token])

  const runSync = useCallback(async () => {
    if (!token) return
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
  }, [processOutbox, refreshOutbox, syncFromServer, token])

  useEffect(() => {
    if (!token) return
    loadLocal().then(refreshOutbox).then(runSync)
  }, [loadLocal, refreshOutbox, runSync, token])

  useEffect(() => {
    if (!token) return
    const handleOnline = () => runSync()
    const handleOffline = () => setSyncState('offline')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runSync])

  useEffect(() => {
    if (!token) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushStatus('unsupported')
      return
    }
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setPushStatus(subscription ? 'enabled' : 'idle')
      })
      .catch(() => setPushStatus('idle'))
  }, [token])

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

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setAuthLoading(true)
    try {
      const payload =
        authMode === 'register'
          ? await registerUser(authForm.email, authForm.password)
          : await loginUser(authForm.email, authForm.password)
      setAuthToken(payload.token)
      setToken(payload.token)
      setAuthForm({ email: '', password: '' })
      await clearEntries()
      await clearOutbox()
      setEntries([])
      setOutbox([])
      await runSync()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    setAuthToken(null)
    setToken(null)
    setEntries([])
    setOutbox([])
    await clearEntries()
    await clearOutbox()
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

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  const enableNotifications = async () => {
    if (!token) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushStatus('unsupported')
      return
    }
    setPushStatus('loading')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setPushStatus('denied')
      return
    }
    const config = await getPushConfig()
    if (!config.publicKey) {
      setError('Push keys are not configured on the server.')
      setPushStatus('idle')
      return
    }
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    })
    await subscribePush(subscription)
    setPushStatus('enabled')
  }

  const triggerTestNotification = async () => {
    setError(null)
    try {
      await sendTestPush()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to send notification'
      setError(message)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] text-[#2C2C2C] font-sans flex justify-center p-4">
        <div className="w-full max-w-md bg-white border border-[#E5E0D8] shadow-sm rounded-xl overflow-hidden">
          <div className="bg-[#2C2C2C] text-[#FDFBF7] p-4 flex items-center justify-between">
            <h1 className="text-xl font-serif font-semibold tracking-wide flex items-center gap-2">
              <Coffee size={20} />
              {text.appTitle}
            </h1>
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
          <form onSubmit={handleAuthSubmit} className="p-5 space-y-4">
            <div className="flex gap-2 text-xs uppercase tracking-widest text-stone-400">
              {(['login', 'register'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAuthMode(mode)}
                  className={`px-3 py-1 rounded-full border ${
                    authMode === mode
                      ? 'border-[#2C2C2C] text-[#2C2C2C]'
                      : 'border-[#E5E0D8] text-stone-500'
                  }`}
                >
                  {mode === 'login' ? text.signIn : text.createAccount}
                </button>
              ))}
            </div>
            <input
              type="email"
              placeholder={text.emailPlaceholder}
              value={authForm.email}
              onChange={(event) =>
                setAuthForm({ ...authForm, email: event.target.value })
              }
              className="w-full bg-white border border-[#E5E0D8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#8B5A2B]"
              required
            />
            <input
              type="password"
              placeholder={text.passwordPlaceholder}
              value={authForm.password}
              onChange={(event) =>
                setAuthForm({ ...authForm, password: event.target.value })
              }
              className="w-full bg-white border border-[#E5E0D8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#8B5A2B]"
              minLength={8}
              required
            />
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-[#2C2C2C] text-[#FDFBF7] py-3 rounded-lg font-bold text-base shadow-lg active:scale-[0.98] transition-all disabled:opacity-70"
            >
              {authLoading
                ? text.signingIn
                : authMode === 'login'
                ? text.signIn
                : text.createAccount}
            </button>
          </form>
        </div>
      </div>
    )
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
            <button
              type="button"
              onClick={handleLogout}
              className="ml-2 text-[11px] uppercase tracking-widest text-stone-300 hover:text-white"
            >
              {text.signOut}
            </button>
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
          <div className="mb-4 rounded-lg border border-[#E5E0D8] bg-white p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-stone-500">
                  {text.notifications}
                </div>
                <div className="text-xs text-stone-400">
                  {pushStatus === 'enabled'
                    ? text.notificationsEnabled
                    : pushStatus === 'unsupported'
                    ? text.notificationsUnavailable
                    : pushStatus === 'denied'
                    ? text.notificationsDenied
                    : text.notificationsHint}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={enableNotifications}
                  disabled={
                    pushStatus === 'enabled' ||
                    pushStatus === 'loading' ||
                    pushStatus === 'unsupported' ||
                    pushStatus === 'denied'
                  }
                  className="px-3 py-2 rounded-lg border border-[#E5E0D8] text-xs font-semibold text-stone-600 disabled:opacity-50"
                >
                  {pushStatus === 'loading' ? text.working : text.enable}
                </button>
                <button
                  type="button"
                  onClick={triggerTestNotification}
                  className="px-3 py-2 rounded-lg border border-[#E5E0D8] text-xs font-semibold text-stone-600"
                >
                  {text.test}
                </button>
              </div>
            </div>
          </div>
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
