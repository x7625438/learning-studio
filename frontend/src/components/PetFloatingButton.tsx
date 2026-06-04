import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { usePetStore } from '../store/petStore'

export default function PetFloatingButton() {
  const { isOpen, setOpen } = usePetStore()

  if (isOpen) return null

  return (
    <motion.button
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => setOpen(true)}
      className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full shadow-2xl flex items-center justify-center z-50 hover:shadow-purple-500/50 transition-shadow"
    >
      <Sparkles className="w-8 h-8 text-white" />
      <motion.div
        className="absolute inset-0 rounded-full bg-white"
        initial={{ scale: 0, opacity: 0.5 }}
        animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </motion.button>
  )
}
