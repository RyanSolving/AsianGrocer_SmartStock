import type OpenAI from 'openai'

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    promise.then(
      (result) => { clearTimeout(timer); resolve(result) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

type OpenAIErrorLike = { status?: number; code?: string | null; param?: string | null; message?: string }

function asOpenAIError(error: unknown): OpenAIErrorLike {
  return typeof error === 'object' && error !== null ? (error as OpenAIErrorLike) : { message: String(error) }
}

/** The model name is wrong or this API key has no access to it. */
export function isModelUnavailable(error: unknown) {
  const { status, code, message = '' } = asOpenAIError(error)
  return status === 404 || code === 'model_not_found' || /model .*(does not exist|not found|do not have access)/i.test(message)
}

/** A request option this model does not take (e.g. temperature on reasoning models). */
export function isUnsupportedOption(error: unknown) {
  const { status, code, message = '' } = asOpenAIError(error)
  return status === 400 && (code === 'unsupported_parameter' || code === 'unsupported_value' || /unsupported (parameter|value)/i.test(message))
}

/**
 * Reads the stocklist photo. Sends only options every current vision model accepts (no
 * temperature: reasoning models such as GPT-6.1 Terra reject it). If the model still
 * refuses an option, retries once with the bare request; if the model is unavailable to
 * this key, retries once on the fallback model.
 */
export async function readPhotoWithOpenAI(
  client: Pick<OpenAI, 'chat'>,
  { model, fallbackModel, prompt, imageUrl, timeoutMs = 300000 }: { model: string; fallbackModel: string; prompt: string; imageUrl: string; timeoutMs?: number },
) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      ],
    },
  ]

  const send = (modelName: string, bare: boolean) => withTimeout(
    client.chat.completions.create(
      bare
        ? { model: modelName, messages }
        : { model: modelName, messages, max_completion_tokens: 16384, response_format: { type: 'json_object' } },
    ),
    timeoutMs,
    `OpenAI request timed out after ${timeoutMs}ms.`,
  )

  const attempt = async (modelName: string) => {
    try {
      return await send(modelName, false)
    } catch (error) {
      if (!isUnsupportedOption(error)) throw error
      console.warn('parse-photo: retrying without optional settings', { model: modelName, param: asOpenAIError(error).param })
      return send(modelName, true)
    }
  }

  let completion
  try {
    completion = await attempt(model)
  } catch (error) {
    if (!isModelUnavailable(error) || !fallbackModel || fallbackModel === model) throw error
    console.warn('parse-photo: model unavailable, using fallback', { model, fallbackModel })
    completion = await attempt(fallbackModel)
  }
  return completion.choices[0]?.message?.content ?? ''
}

/** Plain words for staff, with OpenAI's own message kept as details. */
export function describeOpenAIError(error: unknown): { message: string; details: string } {
  const { status, message = 'Unknown OpenAI error' } = asOpenAIError(error)
  const details = status ? `${status} ${message}` : message
  if (status === 401) return { message: 'Photo reader key is not valid. Ask the admin to check OPENAI_API_KEY.', details }
  if (status === 429) return { message: 'Photo reader is busy or out of credit. Try again soon, or type the counts.', details }
  if (isModelUnavailable(error)) return { message: 'Photo reader model not available. Ask the admin to check OPENAI_VISION_MODEL.', details }
  if (/timed out/i.test(message)) return { message: 'Reading the photo took too long. Try a clearer or smaller photo.', details }
  if (status === 400 && /image/i.test(message)) return { message: 'The photo could not be read. Try a JPG or PNG taken in good light.', details }
  return { message: 'Could not read the photo. Try again, or type the counts.', details }
}

