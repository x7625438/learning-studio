import { useEffect, useState } from 'react'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { useNotificationStore } from '../store'

interface UserProfileDoc {
  id: string
  userId: string
  content: string
  version: number
  lastUpdatedBy: string | null
  lastUpdatedSource: string | null
  updatedAt?: string
}

interface UserProfileDocEditorProps {
  isOpen: boolean
  onClose: () => void
}

export default function UserProfileDocEditor({ isOpen, onClose }: UserProfileDocEditorProps) {
  const [doc, setDoc] = useState<UserProfileDoc | null>(null)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const addNotification = useNotificationStore((s) => s.addNotification)

  useEffect(() => {
    if (isOpen) {
      loadDoc()
    }
  }, [isOpen])

  async function loadDoc() {
    setIsLoading(true)
    try {
      const response = await apiClient.get<{ data: UserProfileDoc }>(API_ENDPOINTS.USER_PROFILE_DOC)
      setDoc(response.data)
      setContent(response.data.content)
    } catch (error) {
      console.error('加载用户档案失败:', error)
      addNotification({ type: 'error', message: '加载用户档案失败' })
    } finally {
      setIsLoading(false)
    }
  }

  async function saveDoc() {
    if (!content.trim()) {
      addNotification({ type: 'warning', message: '内容不能为空' })
      return
    }

    setIsSaving(true)
    try {
      await apiClient.put(API_ENDPOINTS.USER_PROFILE_DOC, {
        content,
        source: 'manual',
      })
      addNotification({ type: 'success', message: '保存成功' })
      await loadDoc()
    } catch (error) {
      console.error('保存失败:', error)
      addNotification({ type: 'error', message: '保存失败' })
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">用户档案文档</h2>
            <p className="text-sm text-gray-500 mt-1">
              AI会根据这份档案更好地了解你，提供个性化的回答
              {doc && <span className="ml-2">· 版本 {doc.version}</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-500">加载中...</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-semibold mb-2">💡 使用说明</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>这份档案会在所有功能模块中提供给AI参考</li>
                  <li>你可以记录学习风格、性格特点、兴趣爱好等信息</li>
                  <li>AI在与你交互时也会自动更新这份档案</li>
                  <li>支持Markdown格式，可以使用标题、列表等</li>
                </ul>
              </div>

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-96 p-4 border-2 border-gray-200 rounded-xl focus:border-blue-400 focus:outline-none resize-none font-mono text-sm"
                placeholder="# 用户档案&#10;&#10;## 基本信息&#10;- 姓名：&#10;- 年龄：&#10;&#10;## 学习风格&#10;- 偏好的学习方式：&#10;&#10;## 性格特点&#10;- ..."
              />

              {doc?.lastUpdatedSource && (
                <div className="text-xs text-gray-500">
                  最后更新：{doc.lastUpdatedSource} 模块
                  {doc.updatedAt && ` · ${new Date(doc.updatedAt).toLocaleString('zh-CN')}`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={saveDoc}
            disabled={isSaving || isLoading}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
