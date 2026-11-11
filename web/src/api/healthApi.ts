import type { BaseQueryFn } from '@reduxjs/toolkit/query'
import { createApi } from '@reduxjs/toolkit/query/react'

import { ApiError, apiRequest } from './client'
import type { components } from './schema'

type Schemas = components['schemas']
export type User = Schemas['User']
export type RequestCodeRequest = Schemas['RequestCodeRequest']
export type VerifyCodeRequest = Schemas['VerifyCodeRequest']
export type Activity = Schemas['Activity']
export type ActivityPage = Schemas['ActivityPage']
export type GarminConnection = Schemas['GarminConnection']
export type GarminConnectResult = Schemas['GarminConnectResult']
export type SyncRun = Schemas['SyncRun']
export type ActivityFieldSetting = Schemas['ActivityFieldSetting']

type QueryArgs = {
  url: string
  method?: string
  body?: unknown
}

type QueryError = {
  status: number
  data: { code: string; message: string }
}

const baseQuery: BaseQueryFn<QueryArgs, unknown, QueryError> = async ({ url, method, body }) => {
  try {
    const data = await apiRequest<unknown>(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { data }
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        error: {
          status: error.status,
          data: { code: error.code, message: error.message },
        },
      }
    }
    return {
      error: {
        status: 0,
        data: { code: 'network_error', message: 'Unable to reach Health.' },
      },
    }
  }
}

export const healthApi = createApi({
  reducerPath: 'healthApi',
  baseQuery,
  tagTypes: ['Session', 'Activities', 'Garmin', 'Sync', 'ActivityFieldSettings'],
  endpoints: (builder) => ({
    getMe: builder.query<User, void>({
      query: () => ({ url: '/v1/me' }),
      providesTags: ['Session'],
    }),
    requestCode: builder.mutation<Schemas['Status'], RequestCodeRequest>({
      query: (body) => ({ url: '/v1/auth/request-code', method: 'POST', body }),
    }),
    verifyCode: builder.mutation<User, VerifyCodeRequest>({
      query: (body) => ({ url: '/v1/auth/verify-code', method: 'POST', body }),
    }),
    getActivities: builder.query<ActivityPage, { type?: string; cursor?: string; limit?: number }>({
      query: ({ type, cursor, limit = 20 }) => {
        const search = new URLSearchParams({ limit: String(limit) })
        if (type && type !== 'all') search.set('type', type)
        if (cursor) search.set('cursor', cursor)
        return { url: `/v1/activities?${search.toString()}` }
      },
      providesTags: ['Activities'],
    }),
    getActivity: builder.query<Activity, string>({
      query: (id) => ({ url: `/v1/activities/${encodeURIComponent(id)}` }),
      providesTags: ['Activities'],
    }),
    getActivityFieldSettings: builder.query<ActivityFieldSetting[], void>({
      query: () => ({ url: '/v1/activity-field-settings' }),
      transformResponse: (response: { items: ActivityFieldSetting[] }) => response.items,
      providesTags: ['ActivityFieldSettings'],
    }),
    saveActivityFieldSetting: builder.mutation<ActivityFieldSetting, ActivityFieldSetting>({
      query: (body) => ({ url: '/v1/activity-field-settings', method: 'POST', body }),
      async onQueryStarted(setting, { dispatch, queryFulfilled }) {
        const update = dispatch(healthApi.util.updateQueryData('getActivityFieldSettings', undefined, (items) => {
          const index = items.findIndex((item) => item.type === setting.type && item.view === setting.view)
          if (index < 0) items.push(setting)
          else items[index] = setting
        }))
        try {
          await queryFulfilled
        } catch {
          update.undo()
        }
      },
      invalidatesTags: (_result, error) => error ? [] : ['ActivityFieldSettings'],
    }),
    getGarminConnection: builder.query<GarminConnection, void>({
      query: () => ({ url: '/v1/integrations/garmin' }),
      providesTags: ['Garmin'],
    }),
    connectGarmin: builder.mutation<GarminConnectResult, Schemas['GarminConnectRequest']>({
      query: (body) => ({ url: '/v1/integrations/garmin/connect', method: 'POST', body }),
      invalidatesTags: (_result, error) => error ? [] : ['Garmin'],
    }),
    verifyGarminMfa: builder.mutation<GarminConnectResult, { challengeId: string; code: string }>({
      query: ({ challengeId, code }) => ({
        url: `/v1/integrations/garmin/challenges/${encodeURIComponent(challengeId)}/verify`,
        method: 'POST',
        body: { code },
      }),
      invalidatesTags: (_result, error) => error ? [] : ['Garmin'],
    }),
    startSync: builder.mutation<Schemas['SyncStart'], { mode: 'recent' | 'full_history' }>({
      query: (body) => ({ url: '/v1/sync-runs', method: 'POST', body }),
      invalidatesTags: ['Garmin'],
    }),
    getSyncRun: builder.query<SyncRun, string>({
      query: (id) => ({ url: `/v1/sync-runs/${encodeURIComponent(id)}` }),
      providesTags: ['Sync'],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: '/v1/auth/logout', method: 'POST' }),
    }),
  }),
})

export const {
  useConnectGarminMutation,
  useGetActivityQuery,
  useGetActivityFieldSettingsQuery,
  useGetActivitiesQuery,
  useGetGarminConnectionQuery,
  useGetMeQuery,
  useGetSyncRunQuery,
  useLazyGetActivitiesQuery,
  useLogoutMutation,
  useRequestCodeMutation,
  useSaveActivityFieldSettingMutation,
  useStartSyncMutation,
  useVerifyCodeMutation,
  useVerifyGarminMfaMutation,
} = healthApi
