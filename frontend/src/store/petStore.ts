import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PetMessage {
  id: string
  role: 'user' | 'assistant'
  message: string
  toolCalls?: any[]
  createdAt: string
}

export interface PetNavigation {
  page: string
  reason: string
}

interface PetState {
  isOpen: boolean
  messages: PetMessage[]
  isLoading: boolean
  navigation: PetNavigation | null

  setOpen: (open: boolean) => void
  addMessage: (message: PetMessage) => void
  setMessages: (messages: PetMessage[]) => void
  setLoading: (loading: boolean) => void
  setNavigation: (navigation: PetNavigation | null) => void
  clearMessages: () => void
}

export const usePetStore = create<PetState>()(
  persist(
    (set) => ({
      isOpen: false,
      messages: [],
      isLoading: false,
      navigation: null,

      setOpen: (open) => set({ isOpen: open }),

      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, message],
        })),

      setMessages: (messages) => set({ messages }),

      setLoading: (loading) => set({ isLoading: loading }),

      setNavigation: (navigation) => set({ navigation }),

      clearMessages: () => set({ messages: [] }),
    }),
    {
      name: 'pet-storage',
      partialize: (state) => ({
        messages: state.messages.slice(-50), // 只保存最近50条消息
      }),
    }
  )
)
