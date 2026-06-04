import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { useAuthStore } from '../store'

export function usePetTracking() {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!user) return

    // 追踪页面访问
    trackAction('page_visit', { path: location.pathname })
  }, [location.pathname, user])

  const trackAction = async (actionType: string, actionData: Record<string, any> = {}) => {
    if (!user) return

    try {
      await apiClient.post(`${API_ENDPOINTS.PET}/action`, {
        actionType,
        actionData,
        page: location.pathname,
      })
    } catch (error) {
      // 静默失败，不影响用户体验
      console.debug('追踪失败:', error)
    }
  }

  return { trackAction }
}
