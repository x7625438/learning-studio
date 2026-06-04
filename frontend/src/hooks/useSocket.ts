import { useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuthStore, useNotificationStore, useProfileStore } from '../store'

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

let socket: Socket | null = null

export function useSocket() {
  const token = useAuthStore((state) => state.token)

  useEffect(() => {
    if (!token) {
      socket?.disconnect()
      socket = null
      return
    }

    socket?.disconnect()
    socket = io(API_BASE_URL || undefined, {
      auth: { token },
      path: '/socket.io',
      transports: ['polling'],
      reconnectionAttempts: 2,
    })

    socket.on('profile_updated', (payload) => {
      useProfileStore.getState().applyWebSocketUpdate(payload)
    })

    socket.on('review_reminder', (payload) => {
      useNotificationStore.getState().addNotification({
        type: 'info',
        message: payload.message || `该复习「${payload.knowledgeName}」了`,
        duration: 0,
      })
    })

    socket.on('connect_error', () => {
      // Dev server polling failures should not interrupt the rest of the app.
    })

    socket.on('error', (payload) => {
      useNotificationStore.getState().addNotification({
        type: 'error',
        message: payload.message || '实时连接异常',
      })
    })

    return () => {
      socket?.disconnect()
      socket = null
    }
  }, [token])
}
