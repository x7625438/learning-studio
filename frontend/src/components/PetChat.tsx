import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send, Sparkles, Trash2, FileText, Paperclip, Image as ImageIcon } from 'lucide-react'
import { usePetStore } from '../store/petStore'
import MarkdownRenderer from './MarkdownRenderer'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { useNavigate } from 'react-router-dom'

export default function PetChat() {
  const navigate = useNavigate()
  const { isOpen, messages, isLoading, navigation, setOpen, addMessage, setMessages, setLoading, setNavigation } =
    usePetStore()
  const [input, setInput] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      loadHistory()
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (navigation) {
      const pageMap: Record<string, string> = {
        'learning-path': '/learning-path',
        practice: '/practice',
        textbook: '/textbook',
        calendar: '/calendar',
        profile: '/profile',
        feynman: '/feynman',
        writing: '/writing',
        'knowledge-graph': '/knowledge-graph',
      }
      const path = pageMap[navigation.page]
      if (path) {
        navigate(path)
        setNavigation(null)
      }
    }
  }, [navigation, navigate, setNavigation])

  const loadHistory = async () => {
    try {
      const response = await apiClient.get<{ conversations: any[] }>(`${API_ENDPOINTS.PET}/history?limit=50`)
      setMessages(response.conversations)
    } catch (error) {
      console.error('加载历史失败:', error)
    }
  }

  const sendMessage = async () => {
    if ((!input.trim() && selectedFiles.length === 0) || isLoading) return

    const userMessage = input.trim()
    const fileNames = selectedFiles.map((f) => f.name).join(', ')
    const displayMessage = userMessage + (fileNames ? `\n📎 ${fileNames}` : '')

    setInput('')
    const filesToSend = [...selectedFiles]
    setSelectedFiles([])

    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      message: displayMessage,
      createdAt: new Date().toISOString(),
    })

    setLoading(true)

    try {
      let response

      if (filesToSend.length > 0) {
        // 使用 FormData 上传文件
        const formData = new FormData()
        formData.append('message', userMessage)
        filesToSend.forEach((file) => {
          formData.append('files', file)
        })

        response = await apiClient.post<{
          message: string
          toolCalls?: any[]
          navigation?: { page: string; reason: string }
        }>(`${API_ENDPOINTS.PET}/chat`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        })
      } else {
        // 普通文本消息
        response = await apiClient.post<{
          message: string
          toolCalls?: any[]
          navigation?: { page: string; reason: string }
        }>(`${API_ENDPOINTS.PET}/chat`, {
          message: userMessage,
        })
      }

      addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        message: response.message,
        toolCalls: response.toolCalls,
        createdAt: new Date().toISOString(),
      })

      if (response.navigation) {
        setNavigation(response.navigation)
      }
    } catch (error) {
      console.error('发送消息失败:', error)
      addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        message: '抱歉，我遇到了一些问题，请稍后再试。',
        createdAt: new Date().toISOString(),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setSelectedFiles((prev) => [...prev, ...files])
  }

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const clearHistory = async () => {
    if (!confirm('确定要清空对话历史吗？')) return

    try {
      await apiClient.post(`${API_ENDPOINTS.PET}/clear-history`)
      setMessages([])
    } catch (error) {
      console.error('清空历史失败:', error)
    }
  }

  const viewMemory = async () => {
    try {
      const response = await apiClient.get<{ content: string; exists: boolean }>(`${API_ENDPOINTS.PET}/memory`)
      if (response.exists) {
        const blob = new Blob([response.content], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'user-memory.md'
        a.click()
        URL.revokeObjectURL(url)
      } else {
        alert('还没有生成记忆档案')
      }
    } catch (error) {
      console.error('获取记忆失败:', error)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="fixed bottom-24 right-6 w-96 h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border border-gray-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-blue-500 to-purple-500 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-purple-500" />
            </div>
            <div>
              <h3 className="font-semibold text-white">小智</h3>
              <p className="text-xs text-white/80">你的学习伙伴</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={viewMemory}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="查看记忆档案"
            >
              <FileText className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={clearHistory}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="清空历史"
            >
              <Trash2 className="w-5 h-5 text-white" />
            </button>
            <button onClick={() => setOpen(false)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <Sparkles className="w-12 h-12 mx-auto mb-4 text-purple-300" />
              <p>你好！我是小智，你的学习伙伴</p>
              <p className="text-sm mt-2">有什么我可以帮助你的吗？</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-800 border border-gray-200'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <MarkdownRenderer content={msg.message} className="text-sm" />
                ) : (
                  <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                )}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-300 text-xs opacity-70">
                    {msg.toolCalls.map((call, idx) => (
                      <div key={idx}>
                        🔧 {call.tool === 'search_web' && '搜索了网络'}
                        {call.tool === 'create_learning_path' && '创建了学习路径'}
                        {call.tool === 'navigate_to_page' && '准备跳转页面'}
                        {call.tool === 'update_user_memory' && '更新了记忆'}
                        {call.tool === 'get_user_learning_status' && '查询了学习状态'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-2 border border-gray-200">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          {/* 文件预览 */}
          {selectedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm"
                >
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="w-4 h-4" />
                  ) : (
                    <Paperclip className="w-4 h-4" />
                  )}
                  <span className="max-w-[150px] truncate">{file.name}</span>
                  <button onClick={() => removeFile(index)} className="hover:text-blue-900">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              accept="image/*,.pdf,.txt,.doc,.docx"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              title="上传文件"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="输入消息..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && selectedFiles.length === 0) || isLoading}
              className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
