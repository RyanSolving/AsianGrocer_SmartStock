import { NextResponse } from 'next/server'

import { getAuthContext } from '../../../lib/supabase/route-auth'

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  try {
    // Fetch all transcription events for current user
    const { data: events, error: eventsError } = await auth.supabase
      .from('event_generate')
      .select(
        `
        uid_generate,
        input_file_name,
        record_name,
        log_time,
        final_output,
        stock_mode
      `
      )
      .eq('user_id', auth.user.id)
      .order('log_time', { ascending: false })

    if (eventsError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch transcription history.',
          details: eventsError.message,
        },
        { status: 400 }
      )
    }

    // Fetch push events to determine which transcriptions were pushed
    const { data: pushEvents, error: pushError } = await auth.supabase
      .from('event_push')
      .select('uid_generate')
      .eq('user_id', auth.user.id)

    if (pushError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch push history.',
          details: pushError.message,
        },
        { status: 400 }
      )
    }

    const pushedUids = new Set(pushEvents?.map((e) => e.uid_generate) || [])

    // Combine data
    const history = (events || []).map((event: any) => ({
      uid_generate: event.uid_generate,
      timestamp: event.log_time,
      filename: event.record_name ?? event.input_file_name,
      transcriptionData: event.final_output,
      stockMode: event.stock_mode,
      isPushed: pushedUids.has(event.uid_generate),
    }))

    return NextResponse.json(
      {
        history,
        count: history.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const auth = await getAuthContext()
  if (auth instanceof NextResponse) {
    return auth
  }

  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const uidGenerate =
    payload && typeof payload === 'object' && typeof (payload as { uid_generate?: unknown }).uid_generate === 'string'
      ? (payload as { uid_generate: string }).uid_generate.trim()
      : ''

  if (!uidGenerate) {
    return NextResponse.json({ error: 'uid_generate is required.' }, { status: 400 })
  }

  try {
    const { error } = await auth.supabase
      .from('event_generate')
      .delete()
      .eq('uid_generate', uidGenerate)
      .eq('user_id', auth.user.id)

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to delete transcription history record.',
          details: error.message,
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ success: true, uid_generate: uidGenerate })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
