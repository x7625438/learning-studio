import { AnimatePresence, motion } from 'framer-motion'
import { useNotificationStore } from '../store'

export default function NotificationToast() {
  const { notifications, removeNotification } = useNotificationStore()

  return (
    <div className="fixed right-4 top-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      <AnimatePresence>
        {notifications.map((notification) => (
          <motion.button
            key={notification.id}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            onClick={() => removeNotification(notification.id)}
            className="paper-card px-4 py-3 text-left text-sm text-stone-800"
          >
            <span className="font-semibold">{labelFor(notification.type)}：</span>
            {notification.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}

function labelFor(type: string) {
  return type === 'error' ? '错误' : type === 'success' ? '完成' : type === 'warning' ? '提醒' : '消息'
}
