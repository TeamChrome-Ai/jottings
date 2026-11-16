/**
 * The assistant's tools (docs/ASSISTANT.md): one table, `assistantTools.json`, read by the server (rs/src/assistant.rs)
 * as it is read here. The model sees every row as a tool it may call; the server runs the `server` rows inside a turn,
 * the app the `app` rows (client/src/lib/assistantActions.ts). No tool exists outside the table, and a test on each side
 * fails when a row has no executor there.
 *
 * `changes`: the tool changes something of the reader's (a setting, a bookmark, what is playing). Such a call is honoured
 * only when the model asked for it before any server tool's result but the guide's came back for the reader's message,
 * and each one shows a line with Undo.
 */
import rows from './assistantTools.json'

export type ToolSide = 'server' | 'app'
export interface PropertySchema {
  type: 'string' | 'number' | 'integer' | 'boolean'
  description?: string
  enum?: readonly (string | number)[]
  minimum?: number
  maximum?: number
  maxLength?: number
}
export interface InputSchema { type: 'object'; properties: Record<string, PropertySchema>; required?: readonly string[]; additionalProperties: false }
export interface ToolRow { name: string; description: string; input: InputSchema; runs: ToolSide; changes: boolean }

export const TOOLS = rows as unknown as readonly ToolRow[]
export const toolRow = (name: string): ToolRow | undefined => TOOLS.find(r => r.name === name)

/** Model calls a reader message may take at most, its tools' rounds included. */
export const TURN_CALLS = 6

/** A call the model made, as chat completions carry it: `arguments` is the JSON text the model wrote. */
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
/** The conversation as the model sees it, less the system prompt the server adds. Kept on the device. */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/** A paragraph of the library as a library tool returns it; `text` is left out once the reader has moved on. */
/** Each call's id to the tool it named, for reading a tool message by what made it (the server's `call_names`). */
export const callNames = (messages: readonly ChatMessage[]): Map<string, string> =>
  new Map(messages.flatMap(m => (m.role === 'assistant' ? m.tool_calls ?? [] : [])).map(c => [c.id, c.function.name]))
export interface ParagraphRef { id: number; author: string; work: { id: string; title: string; collection: string }; n: number; para: number; section: string; text?: string }

/** One sentence of a finished answer: the paragraph ids it rests on, checked against those the tools gave in this
 *  conversation; `supported` is false for a sentence of an answer from the library that rests on none. */
export interface Sentence { text: string; ids: number[]; supported: boolean }

/** `POST /api/assistant/turn`: the conversation, and to go on after the app has run tools, the token the server gave. */
export interface TurnRequest { messages: ChatMessage[]; token?: string }
/** The server-sent events of a turn, in order: words as they come, messages to keep, then one of answer, pending or
 *  error, then done. */
export type TurnEvent =
  | { event: 'text'; data: { t: string } }
  | { event: 'message'; data: ChatMessage }
  | { event: 'answer'; data: { sentences: Sentence[] } }
  | { event: 'pending'; data: { calls: ToolCall[]; token: string } }
  | { event: 'error'; data: { error: string } }
  | { event: 'done'; data: Record<string, never> }

/** `GET /api/assistant`: whether Ask is on, and a reader's messages a day. */
export interface AssistantState { on: boolean; each: number }
/** The 429 of a reader message past a cap, made before any model call. */
export interface CapReached { error: string; cap: 'account' | 'day'; resets_at: string }
