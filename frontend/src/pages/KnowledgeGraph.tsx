import { FormEvent, useMemo, useState } from 'react'
import { EmptyState, PageShell, SectionCard } from '../components/PageShell'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { KGNode } from '../types/api'
import { useGraphStore } from '../store'

type StarPosition = {
  id: string
  x: number
  y: number
  size: number
}

const CANVAS_WIDTH = 1000
const CANVAS_HEIGHT = 640

const constellationSeeds = [
  [500, 320],
  [270, 180],
  [720, 165],
  [180, 390],
  [810, 420],
  [430, 120],
  [590, 505],
  [350, 455],
  [660, 305],
  [125, 245],
  [875, 255],
  [510, 215],
  [245, 520],
  [755, 535],
  [390, 300],
  [610, 90],
  [500, 575],
  [910, 360],
]

const relationLabels: Record<string, string> = {
  prerequisite: '前置',
  includes: '包含',
  related: '相关',
}

const masteryLabels: Record<KGNode['masteryStatus'], string> = {
  mastered: '已掌握',
  learning: '学习中',
  unvisited: '未开始',
}

export default function KnowledgeGraph() {
  const { graph, generate, markNode } = useGraphStore()
  const [topic, setTopic] = useState('机器学习')
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const positions = useMemo(() => makeStarPositions(graph?.nodes || []), [graph?.nodes])
  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) || graph?.nodes[0]
  const selectedRelations =
    graph?.edges.filter(
      (edge) => edge.sourceId === selectedNode?.id || edge.targetId === selectedNode?.id
    ) || []

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedTopic = topic.trim()
    if (!trimmedTopic) return
    setIsGenerating(true)
    setErrorMessage('')
    try {
      await generate(trimmedTopic)
      setSelectedNodeId(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'AI 知识图谱分析失败，请稍后重试。')
    } finally {
      setIsGenerating(false)
    }
  }

  async function toggleMastery(node: KGNode) {
    setSelectedNodeId(node.id)
    await markNode(node.id, node.masteryStatus === 'mastered' ? 'learning' : 'mastered')
  }

  return (
    <PageShell
      eyebrow="P3-4 Graph"
      title="知识图谱"
      description="让 AI 先总结主题知识点和连接关系，再生成一片可交互的知识星空。"
    >
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-5">
          <SectionCard title="生成星空图">
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                className="field"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="输入一个想学习的主题"
              />
              <button className="warm-button w-full" disabled={isGenerating}>
                {isGenerating ? 'AI 正在分析知识关系...' : '生成知识星空'}
              </button>
            </form>
            {errorMessage && (
              <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm leading-6 text-rose-700">
                {errorMessage}
              </p>
            )}
            {graph && (
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-white/70 p-3">
                  <p className="text-stone-500">知识点</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-950">{graph.nodes.length}</p>
                </div>
                <div className="rounded-2xl bg-white/70 p-3">
                  <p className="text-stone-500">连接</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-950">{graph.edges.length}</p>
                </div>
              </div>
            )}
          </SectionCard>

          {graph && selectedNode && (
            <SectionCard title={selectedNode.name} description={masteryLabels[selectedNode.masteryStatus]}>
              <p className="text-sm leading-7 text-stone-600">
                {selectedNode.description || '这个知识点是当前主题中的一个关键节点。'}
              </p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                预计 {selectedNode.estimatedHours} 小时 · Level {selectedNode.level}
              </p>
              <div className="mt-4 space-y-2">
                {selectedRelations.slice(0, 5).map((edge) => (
                  <p
                    key={`${edge.sourceId}-${edge.targetId}`}
                    className="rounded-2xl bg-emerald-950/5 p-3 text-xs leading-5 text-stone-600"
                  >
                    <span className="font-semibold text-emerald-900">
                      {relationLabels[edge.relationType] || '相关'}：
                    </span>
                    {edge.reason}
                  </p>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        <SectionCard title={graph?.topic || '知识星空'}>
          {graph ? (
            <div>
              {graph.summary && (
                <div className="mb-4 rounded-2xl bg-white/70 p-4">
                  <MarkdownRenderer content={graph.summary} className="text-sm leading-7 text-stone-600" />
                </div>
              )}
              <div className="relative min-h-[520px] overflow-hidden rounded-[1.5rem] border border-indigo-200/20 bg-[#07111f] shadow-[inset_0_0_80px_rgba(14,165,233,0.12)]">
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                  role="img"
                  aria-label={`${graph.topic} 的知识星空关系图`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.72" />
                      <stop offset="100%" stopColor="#fef3c7" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  {positions.slice(0, 18).map((star, index) => (
                    <circle
                      key={`dust-${star.id}`}
                      cx={(star.x + 47 * index) % CANVAS_WIDTH}
                      cy={(star.y + 83 * index) % CANVAS_HEIGHT}
                      r={index % 3 === 0 ? 1.8 : 1.1}
                      fill="#f8fafc"
                      opacity={0.2 + (index % 4) * 0.08}
                    />
                  ))}
                  {graph.edges.map((edge) => {
                    const source = positions.find((position) => position.id === edge.sourceId)
                    const target = positions.find((position) => position.id === edge.targetId)
                    if (!source || !target) return null
                    return (
                      <line
                        key={`${edge.sourceId}-${edge.targetId}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="#bae6fd"
                        strokeDasharray="10 12"
                        strokeLinecap="round"
                        strokeOpacity={selectedNode && [edge.sourceId, edge.targetId].includes(selectedNode.id) ? 0.72 : 0.24}
                        strokeWidth={selectedNode && [edge.sourceId, edge.targetId].includes(selectedNode.id) ? 2.2 : 1.4}
                      />
                    )
                  })}
                  {positions.map((star) => (
                    <circle
                      key={`glow-${star.id}`}
                      cx={star.x}
                      cy={star.y}
                      r={star.size * 2.4}
                      fill="url(#starGlow)"
                      opacity={selectedNode?.id === star.id ? 0.9 : 0.36}
                    />
                  ))}
                </svg>

                {graph.nodes.map((node) => {
                  const star = positions.find((position) => position.id === node.id)
                  if (!star) return null
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => toggleMastery(node)}
                      className={`group absolute -translate-x-1/2 -translate-y-1/2 text-center transition duration-200 hover:scale-110 focus:outline-none focus:ring-4 focus:ring-sky-200/30 ${
                        selectedNode?.id === node.id ? 'z-20 scale-110' : 'z-10'
                      }`}
                      style={{
                        left: `${(star.x / CANVAS_WIDTH) * 100}%`,
                        top: `${(star.y / CANVAS_HEIGHT) * 100}%`,
                        width: `${Math.max(92, star.size * 7)}px`,
                      }}
                      aria-label={`${node.name}，${masteryLabels[node.masteryStatus]}`}
                    >
                      <span
                        className={`mx-auto block rounded-full shadow-[0_0_26px_rgba(252,211,77,0.8)] ${
                          node.masteryStatus === 'mastered'
                            ? 'bg-emerald-200'
                            : node.masteryStatus === 'learning'
                              ? 'bg-amber-200'
                              : 'bg-sky-100'
                        }`}
                        style={{ width: star.size, height: star.size }}
                      />
                      <span className="mt-2 block rounded-full bg-slate-950/50 px-2 py-1 text-[11px] font-semibold leading-4 text-amber-50 backdrop-blur group-hover:bg-slate-950/80">
                        {node.name}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              title="还没有生成星空图"
              description="输入一个主题，AI 会总结知识点、关系和学习连接。"
            />
          )}
        </SectionCard>
      </div>
    </PageShell>
  )
}

function makeStarPositions(nodes: KGNode[]): StarPosition[] {
  return nodes.map((node, index) => {
    const seed = constellationSeeds[index % constellationSeeds.length]
    const orbitOffset = Math.min(node.level, 4) * 28
    const wave = (index % 5) * 9
    return {
      id: node.id,
      x: Math.max(82, Math.min(CANVAS_WIDTH - 82, seed[0] + orbitOffset - wave)),
      y: Math.max(70, Math.min(CANVAS_HEIGHT - 70, seed[1] + wave - orbitOffset / 2)),
      size: Math.max(10, 22 - node.level * 2 + (index % 3) * 2),
    }
  })
}
