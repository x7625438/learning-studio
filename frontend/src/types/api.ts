export type ISO8601 = string

export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface User {
  id: string
  username: string
  createdAt?: ISO8601
  updatedAt?: ISO8601
  lastLoginAt?: ISO8601
}

export interface AuthPayload {
  user: User
  token: string
}

export interface LearningProfile {
  id: string
  userId: string
  goal: string | null
  currentStage: string | null
  selfIntroduction: string | null
  learningPreferences: string | null
  totalStudyHours: number
  streakDays: number
  lastStudyAt: ISO8601 | null
  weeklyStudyHoursTarget: number
  dailyPracticeCountTarget: number
  emotionEnabled: boolean
  createdAt: ISO8601
  updatedAt: ISO8601
}

export interface WeakPoint {
  id: string
  userId?: string
  knowledgeName: string
  masteryScore: number
  errorCount: number
  correctCount: number
  priority: 'high' | 'medium' | 'low'
  lastPracticedAt: ISO8601 | null
  nextReviewAt: ISO8601 | null
  reviewInterval: number
  source: 'qa' | 'practice' | 'textbook' | string
  ignored?: boolean
  createdAt?: ISO8601
  updatedAt?: ISO8601
}

export interface StudyHistoryItem {
  id: string
  sourceType: string
  sourceId?: string
  summary: string
  knowledgePoints?: string[]
  createdAt: ISO8601
}

export interface ProfileDashboard {
  profile: LearningProfile
  weakPoints: WeakPoint[]
  recentHistory: StudyHistoryItem[]
  today: {
    studyMinutes: number
    studySeconds: number
    practiceCount: number
  }
}

export interface PracticeQuestion {
  id: string
  weakPointId?: string
  knowledgeName: string
  questionText: string
  choices: { key: string; text: string }[]
  correctAnswer: string
  hint?: string
  explanation?: string
  bloomLevel?: string
  desirableDifficulty?: string
  adaptiveReason?: string
  sourceType?: string
  diagramSvg?: string
}

export interface DailyPracticeTask {
  date: string
  targetCount: number
  completedCount: number
  questions: PracticeQuestion[]
  emptyReason?: string
  paperMeta?: {
    strategy?: string
    focus?: {
      knowledgeName: string
      masteryScore: number
      dueDays: number
      adaptiveScore: number
      reason: string
    }[]
    bloomDistribution?: Record<string, number>
    difficultyMix?: Record<string, number>
    sourceMix?: Record<string, number>
  }
}

export interface PaperSection {
  index: number
  textEn: string
  textCn: string
  type?: 'paragraph' | 'title' | 'table' | 'figure' | 'list'
  isRead: boolean
  keyTerms: { term: string; definition: string; pageNum?: number }[]
}

export interface HeatmapCell {
  date: string
  intensity: 0 | 1 | 2 | 3
  studyMinutes: number
  studySeconds: number
}

export interface WeeklyStats {
  weekStart: string
  weekEnd: string
  totalStudyMinutes: number
  totalStudySeconds: number
  targetStudyMinutes: number
  practiceCount: number
  targetPracticeCount: number
  focusDays: number
  targetFocusDays: number
  achievements: { type: string; title: string; achievedAt: ISO8601 }[]
}

export interface LearningPath {
  id: string
  topic: string
  current_level?: string
  goal?: string
  status: string
  weeks?: WeekPlan[]
  weeks_data?: WeekPlan[]
}

export interface WeekPlan {
  weekNumber: number
  title: string
  topics: string[]
  exercises: string[]
  reviewTopics: string[]
  status: 'pending' | 'in_progress' | 'completed'
  completedAt: ISO8601 | null
}

export interface KGNode {
  id: string
  name: string
  description?: string
  level: number
  masteryStatus: 'mastered' | 'learning' | 'unvisited'
  estimatedHours: number
  parentIds: string[]
}

export interface KGEdge {
  sourceId: string
  targetId: string
  relationType: 'prerequisite' | 'includes' | 'related'
  reason: string
}

export interface KnowledgeGraph {
  id: string
  graphId?: string
  topic: string
  summary?: string
  nodes: KGNode[]
  edges: KGEdge[]
}

export interface StreamEvent {
  event: string
  data: Record<string, unknown>
}

// ---- Essay Grading ----

export interface RubricDimension {
  name: string
  maxScore: number
  description: string
}

export interface RubricTemplate {
  id: string
  userId?: string | null
  name: string
  examType: string
  dimensions: RubricDimension[]
  totalScore: number
  isPreset: boolean
  createdAt?: ISO8601
  updatedAt?: ISO8601
}

export interface RubricListData {
  presets: RubricTemplate[]
  custom: RubricTemplate[]
}

export interface DimensionScore {
  name: string
  score: number
  maxScore: number
  feedback: string
  evidence: string[]
}

export interface EssayGradingSession {
  id: string
  title: string
  essayText: string
  rubricId?: string
  rubricSnapshot: {
    name: string
    examType: string
    dimensions: RubricDimension[]
    totalScore: number
  }
  examType: string
  totalScore?: number
  dimensionScores: DimensionScore[]
  overallFeedback: string
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  status: 'pending' | 'processing' | 'completed' | 'error'
  createdAt: ISO8601
  updatedAt?: ISO8601
}

export interface SSEProgressEvent {
  type: 'progress'
  phase: string
  message: string
  percentage: number
}

export interface SSEDimensionEvent {
  type: 'dimension'
  index: number
  total: number
  data: DimensionScore
}

export interface SSEFinalEvent {
  type: 'final'
  data: {
    dimensionScores: DimensionScore[]
    totalScore: number
    overallFeedback: string
    strengths: string[]
    weaknesses: string[]
    suggestions: string[]
  }
}

export interface SSEErrorEvent {
  type: 'error'
  message: string
}

export type EssayGradingSSEEvent =
  | SSEProgressEvent
  | SSEDimensionEvent
  | SSEFinalEvent
  | SSEErrorEvent
  | { type: 'done' }

// ---- Knowledge Memories ----

export interface KnowledgeMemory {
  id: string
  userId?: string
  title: string
  content: string
  summary: string
  subject: string
  topic: string
  memoryType: 'concept' | 'fact' | 'insight' | 'skill' | 'question'
  tags: string[]
  sourceType:
    | 'manual'
    | 'auto-qa'
    | 'auto-practice'
    | 'auto-feynman'
    | 'auto-textbook'
    | 'auto-wrong_questions'
    | 'consolidation'
    | string
  sourceId?: string | null
  masteryLevel: number
  easinessFactor: number
  intervalDays: number
  repetitions: number
  nextReviewAt: ISO8601 | null
  lastReviewedAt: ISO8601 | null
  reviewCount: number
  importance: number
  interactionCount: number
  isConsolidated: boolean
  archived: boolean
  createdAt: ISO8601
  updatedAt: ISO8601
  // Extra fields from search/retrieval
  _distance?: number
  _source?: 'vector' | 'keyword'
  _daysOverdue?: number
  reviewHistory?: KnowledgeMemoryReview[]
}

export interface KnowledgeMemoryReview {
  id: string
  quality: number
  responseTimeSeconds: number
  easeBefore: number
  easeAfter: number
  intervalBefore: number
  intervalAfter: number
  createdAt: ISO8601
}

export interface KnowledgeStats {
  total: number
  dueToday: number
  averageMastery: number
  bySubject: Record<string, number>
  byType: Record<string, number>
}

export interface CreateMemoryPayload {
  title: string
  content: string
  summary?: string
  subject?: string
  topic?: string
  memoryType?: KnowledgeMemory['memoryType']
  tags?: string[]
  importance?: number
}

export interface UpdateMemoryPayload {
  title?: string
  content?: string
  summary?: string
  subject?: string
  topic?: string
  memoryType?: KnowledgeMemory['memoryType']
  tags?: string[]
  importance?: number
  archived?: boolean
}

export interface KnowledgeFilters {
  subject?: string
  topic?: string
  memoryType?: KnowledgeMemory['memoryType']
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// ---- Tutoring (启发讲题) ----

export interface TutoringSession {
  id: string
  problemText: string
  problemImagePath?: string | null
  subject: string
  knowledgePoints: string[]
  difficulty: string
  gradeLevel: string
  status: 'active' | 'completed'
  currentStep: number
  totalSteps: number
  hintsGiven: { step: number; hint: string }[]
  dialogue: TutoringDialogueEntry[]
  solved: boolean
  createdAt: ISO8601
  updatedAt: ISO8601
}

export interface TutoringDialogueEntry {
  role: 'student' | 'tutor'
  content: string
  step?: number
  timestamp?: ISO8601 | null
}

export interface TutoringStartResponse {
  sessionId: string
  problemAnalysis: {
    subject: string
    knowledgePoints: string[]
    difficulty: string
    gradeLevel: string
  }
  greeting: string
}

export interface TutoringSessionListItem {
  id: string
  problemText: string
  subject: string
  difficulty: string
  status: 'active' | 'completed'
  solved: boolean
  currentStep: number
  totalSteps: number
  createdAt: ISO8601
  updatedAt: ISO8601
}
