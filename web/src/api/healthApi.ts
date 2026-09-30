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
        data: { code: 'network_error', message: 'Unable to reach Health Hub.' },
      },
    }
  }
}

export const healthApi = createApi({
  reducerPath: 'healthApi',
  baseQuery,
  tagTypes: ['Session', 'Activities', 'Garmin', 'Sync'],
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
  useGetActivitiesQuery,
  useGetGarminConnectionQuery,
  useGetMeQuery,
  useGetSyncRunQuery,
  useLazyGetActivitiesQuery,
  useLogoutMutation,
  useRequestCodeMutation,
  useStartSyncMutation,
  useVerifyCodeMutation,
  useVerifyGarminMfaMutation,
} = healthApi
