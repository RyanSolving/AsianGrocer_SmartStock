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
      filename: event.input_file_name,
      transcriptionData: event.final_output,
      stockMode: event.stock_mode,
      isPushed: pushedUids.has(event.uid_generate),
    }))

    return NextResponse.json({
      history,
      count: history.length,
    })
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
