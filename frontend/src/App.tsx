import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import NotificationToast from './components/NotificationToast'
import ProtectedRoute from './components/ProtectedRoute'
import Calendar from './pages/Calendar'
import Feynman from './pages/Feynman'
import Home from './pages/Home'
import KnowledgeGraph from './pages/KnowledgeGraph'
import LearningPath from './pages/LearningPath'
import Login from './pages/Login'
import Practice from './pages/Practice'
import Profile from './pages/Profile'
import QA from './pages/QA'
import Register from './pages/Register'
import Textbook from './pages/Textbook'
import WrongQuestions from './pages/WrongQuestions'
import EssayGrading from './pages/EssayGrading'
import KnowledgeBase from './pages/KnowledgeBase'
import Tutoring from './pages/Tutoring'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<ProtectedRoute />}>
            <Route
              path="/"
              element={
                <Layout>
                  <Home />
                </Layout>
              }
            />
            <Route
              path="/profile"
              element={
                <Layout>
                  <Profile />
                </Layout>
              }
            />
            <Route
              path="/qa"
              element={
                <Layout>
                  <QA />
                </Layout>
              }
            />
            <Route
              path="/textbook"
              element={
                <Layout>
                  <Textbook />
                </Layout>
              }
            />
            <Route
              path="/practice"
              element={
                <Layout>
                  <Practice />
                </Layout>
              }
            />
            <Route
              path="/calendar"
              element={
                <Layout>
                  <Calendar />
                </Layout>
              }
            />
            <Route
              path="/feynman"
              element={
                <Layout>
                  <Feynman />
                </Layout>
              }
            />
            <Route
              path="/learning-path"
              element={
                <Layout>
                  <LearningPath />
                </Layout>
              }
            />
            <Route
              path="/knowledge-graph"
              element={
                <Layout>
                  <KnowledgeGraph />
                </Layout>
              }
            />
            <Route
              path="/wrong-questions"
              element={
                <Layout>
                  <WrongQuestions />
                </Layout>
              }
            />
            <Route
              path="/essay-grading"
              element={
                <Layout>
                  <EssayGrading />
                </Layout>
              }
            />
            <Route
              path="/knowledge-base"
              element={
                <Layout>
                  <KnowledgeBase />
                </Layout>
              }
            />
            <Route
              path="/tutoring"
              element={
                <Layout>
                  <Tutoring />
                </Layout>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <NotificationToast />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
