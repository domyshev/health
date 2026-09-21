import { combineReducers, configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { createMigrate, persistReducer, persistStore } from 'redux-persist'

import { healthApi } from './api/healthApi'

const storage = {
  getItem: (key: string) => Promise.resolve(window.localStorage.getItem(key)),
  setItem: (key: string, value: string) => {
    window.localStorage.setItem(key, value)
    return Promise.resolve(value)
  },
  removeItem: (key: string) => {
    window.localStorage.removeItem(key)
    return Promise.resolve()
  },
}

interface UiState {
  activityType: string
}

const initialUiState: UiState = { activityType: 'all' }

const uiSlice = createSlice({
  name: 'ui',
  initialState: initialUiState,
  reducers: {
    setActivityType(state, action: PayloadAction<string>) {
      state.activityType = action.payload
    },
    resetUiState() {
      return initialUiState
    },
  },
})

export const { resetUiState, setActivityType } = uiSlice.actions

const persistConfig = {
  key: 'health-hub:ui',
  version: 1,
  storage,
  migrate: createMigrate({ 1: (state) => state }, { debug: false }),
}

const appReducer = combineReducers({
  [healthApi.reducerPath]: healthApi.reducer,
  ui: uiSlice.reducer,
})

const persistedReducer = combineReducers({
  [healthApi.reducerPath]: healthApi.reducer,
  ui: persistReducer<UiState>(persistConfig, uiSlice.reducer),
})

export function createAppStore() {
  return configureStore({
    reducer: appReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(healthApi.middleware),
  })
}

export function createPersistedAppStore() {
  const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE', 'persist/FLUSH', 'persist/PAUSE', 'persist/PURGE', 'persist/REGISTER'],
      },
    }).concat(healthApi.middleware),
  })
  return { store, persistor: persistStore(store) }
}

const persisted = createPersistedAppStore()
export const store = persisted.store
export const persistor = persisted.persistor
export type AppStore = ReturnType<typeof createAppStore>
export type RootState = ReturnType<typeof appReducer>
export type AppDispatch = AppStore['dispatch']
