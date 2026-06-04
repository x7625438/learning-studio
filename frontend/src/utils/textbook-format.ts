export function formatAiAnswer(text: string) {
  return text
    .replace(/[  ]/g, ' ')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/^'''|'''$/g, '')
    .replace(/^"""|"""$/g, '')
    .replace(/^根据提供的教材内容[^\n]*\n+/u, '')
    .replace(/^根据提供的内容[^\n]*\n+/u, '')
    .replace(/^根据OCR识别结果[^\n]*\n+/u, '')
    .replace(/^以下是根据[^\n]*\n+/u, '')
    .replace(/\n+如果您指的是其他[^\n]*/u, '')
    .replace(/\n+如果你指的是其他[^\n]*/u, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const formatTextbookAnswer = formatAiAnswer
