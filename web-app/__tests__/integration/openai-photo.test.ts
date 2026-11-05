/**
 * Photo reading: the request avoids options reasoning models reject, retries without
 * optional settings when one is refused, and falls back when the model is unavailable.
 */
import { describe, expect, it } from '@jest/globals'

import { describeOpenAIError, readPhotoWithOpenAI } from '../../lib/openai-photo'

type Call = Record<string, unknown>

function fakeClient(responses: Array<Error | string>) {
  const calls: Call[] = []
  const client = {
    chat: {
      completions: {
        create: async (body: Call) => {
          calls.push(body)
          const next = responses.shift()
          if (next instanceof Error) throw next
          return { choices: [{ message: { content: next ?? '' } }] }
        },
      },
    },
  }
  return { client: client as never, calls }
}

const apiError = (status: number, message: string, code?: string) =>
  Object.assign(new Error(message), { status, code })

const input = { model: 'gpt-6.1-terra', fallbackModel: 'gpt-5.2', prompt: 'p', imageUrl: 'data:image/png;base64,AA' }

describe('readPhotoWithOpenAI', () => {
  it('never sends temperature', async () => {
    const { client, calls } = fakeClient(['{"items":[]}'])
    await expect(readPhotoWithOpenAI(client, input)).resolves.toBe('{"items":[]}')
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toHaveProperty('temperature')
    expect(calls[0].model).toBe('gpt-6.1-terra')
  })

  it('retries once without optional settings when an option is refused', async () => {
    const { client, calls } = fakeClient([
      apiError(400, "Unsupported parameter: 'response_format' is not supported with this model.", 'unsupported_parameter'),
      '{"items":[]}',
    ])
    await readPhotoWithOpenAI(client, input)
    expect(calls).toHaveLength(2)
    expect(calls[1]).not.toHaveProperty('response_format')
    expect(calls[1]).not.toHaveProperty('max_completion_tokens')
  })

  it('uses the fallback model when the model is not available', async () => {
    const { client, calls } = fakeClient([apiError(404, 'The model `gpt-6.1-terra` does not exist', 'model_not_found'), '{}'])
    await readPhotoWithOpenAI(client, input)
    expect(calls.map((call) => call.model)).toEqual(['gpt-6.1-terra', 'gpt-5.2'])
  })

  it('does not retry other errors', async () => {
    const { client, calls } = fakeClient([apiError(401, 'Incorrect API key provided')])
    await expect(readPhotoWithOpenAI(client, input)).rejects.toThrow('Incorrect API key')
    expect(calls).toHaveLength(1)
  })
})

describe('describeOpenAIError', () => {
  it('names the cause in plain words and keeps the raw message', () => {
    expect(describeOpenAIError(apiError(401, 'Incorrect API key provided')).message).toMatch(/OPENAI_API_KEY/)
    expect(describeOpenAIError(apiError(429, 'quota')).message).toMatch(/busy or out of credit/)
    expect(describeOpenAIError(apiError(404, 'model not found', 'model_not_found')).details).toBe('404 model not found')
  })
})
