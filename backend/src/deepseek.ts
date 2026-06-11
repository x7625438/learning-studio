const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-chat'

const EXTRACTION_PROMPT = `你是保险智能获客平台的AI助手。请从用户的自然语言描述中提取客户信息，并以JSON格式返回。

可提取的字段：
- name: 客户姓名
- age: 年龄
- gender: 性别
- city: 城市
- family: 婚姻/家庭状况
- children: 子女情况
- job: 职业
- income: 收入范围
- assets: 资产规模
- products: 感兴趣的产品
- budget: 预算
- supplement: 补充需求

只返回JSON，不要其他文字。如果某个字段无法确定，设为null。`

const CHAT_SYSTEM_PROMPT = `你是保险智能获客平台的AI助手。你的任务是帮助用户梳理和录入客户信息。

你需要：
1. 友好地引导用户提供客户信息
2. 自动提取关键信息并整理
3. 在信息不完整时，礼貌地询问缺失的字段
4. 当信息足够时，提示用户去页面右侧勾选"客户已同意"并点击"保存客户信息"按钮来生成工单

重要规则：
- 你只能在用户点击按钮后才能生成工单，不要在聊天中说"工单已生成"或"已提交"等会让用户误以为工单已经自动完成的话
- 当前对话语言：中文。保持专业、友好的语气。
- 回复中不要使用 Markdown 格式（如 **粗体**、*斜体*、# 标题等），使用纯文本即可。

你每次回复时，在末尾附上提取到的客户信息JSON（放在 <extracted>{}</extracted> 标签内）。
如果字段未确定，值设为 null。`

export async function extractCustomerInfo(text: string): Promise<Record<string, string | null>> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DeepSeek API key is not configured')
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`DeepSeek API error: ${response.status} ${err}`)
  }

  const data = await response.json()
  const content = data.choices[0].message.content
  return JSON.parse(content)
}

export async function chatWithAI(
  history: Array<{ role: string; content: string }>,
  userMessage: string
): Promise<{ reply: string; extracted: Record<string, string | null> }> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DeepSeek API key is not configured')
  }

  const messages = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`DeepSeek API error: ${response.status} ${err}`)
  }

  const data = await response.json()
  const content: string = data.choices[0]?.message?.content ?? ''

  // Check for content moderation or error responses
  const errorPatterns = ['内容不存在', '已被删除', '无法提供', '审核', '违反', '不合适']
  if (errorPatterns.some(p => content.includes(p)) && content.length < 50) {
    throw new Error(`DeepSeek content error: ${content}`)
  }

  // Extract JSON from <extracted> tags
  let extracted: Record<string, string | null> = {}
  const match = content.match(/<extracted>([\s\S]*?)<\/extracted>/)
  if (match) {
    try {
      extracted = JSON.parse(match[1])
    } catch {
      extracted = {}
    }
  }

  // Remove the extracted tag from reply
  const reply = content.replace(/<extracted>[\s\S]*?<\/extracted>/, '').trim()

  return { reply, extracted }
}
