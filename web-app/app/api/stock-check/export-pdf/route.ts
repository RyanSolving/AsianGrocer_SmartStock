import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '../../../../lib/supabase/route-auth'

const stockCheckPayloadSchema = z.object({
  date: z.string(),
  items: z.array(
    z.object({
      code: z.string(),
      product: z.string(),
      category: z.string(),
      location: z.string(),
      sub_location: z.string(),
      official_name: z.string(),
      stocklist_name: z.string(),
      quantity: z.number().nullable(),
      red_marked: z.boolean(),
      notes: z.string(),
    })
  ),
  unknown_items: z.array(
    z.object({
      user_input: z.string(),
      quantity: z.number().nullable(),
      red_marked: z.boolean(),
      notes: z.string(),
    })
  ).optional(),
  validated: z.boolean(),
  export_format: z.enum(['csv', 'pdf', 'image']).optional(),
})

function generateHtmlToPrint(payload: z.infer<typeof stockCheckPayloadSchema>): string {
  const itemsHtml = payload.items
    .map(
      item => `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.code}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.official_name}</td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
        <span style="display: inline-block; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #ddd; background-color: ${
          item.red_marked ? '#dc2626' : 'transparent'
        };"></span>
      </td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.quantity ?? '-'}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.notes}</td>
    </tr>
  `
    )
    .join('')

  const unknownItemsHtml = (payload.unknown_items ?? [])
    .map(
      item => `
    <tr style="background-color: #fef3c7;">
      <td style="padding: 8px; border: 1px solid #ddd;">NEW</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.user_input}</td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
        <span style="display: inline-block; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #ddd; background-color: ${
          item.red_marked ? '#dc2626' : 'transparent'
        };"></span>
      </td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.quantity ?? '-'}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.notes}</td>
    </tr>
  `
    )
    .join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Stock Check - ${payload.date}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      color: #333;
    }
    h1 {
      text-align: center;
      font-size: 24px;
      margin-bottom: 10px;
    }
    .meta {
      text-align: center;
      font-size: 12px;
      color: #666;
      margin-bottom: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    th {
      background-color: #f3f4f6;
      padding: 10px;
      text-align: left;
      border: 1px solid #ddd;
      font-weight: bold;
    }
    td {
      padding: 8px;
      border: 1px solid #ddd;
    }
    .section-header {
      background-color: #e5e7eb;
      padding: 12px;
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 10px;
      border-radius: 4px;
    }
    .red-circle {
      display: inline-block;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid #ddd;
    }
    .red-marked {
      background-color: #dc2626;
    }
    @media print {
      body {
        margin: 0;
      }
      table {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <h1>Stock Check Report</h1>
  <div class="meta">
    <p>Date: ${payload.date} | Validated: ${payload.validated ? 'Yes' : 'No'}</p>
  </div>
  
  <div class="section-header">Regular Items (${payload.items.length})</div>
  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Product</th>
        <th>Mark</th>
        <th style="width: 80px;">Quantity</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  ${
    (payload.unknown_items ?? []).length > 0
      ? `
  <div class="section-header">New Items to Create (${payload.unknown_items?.length ?? 0})</div>
  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Product</th>
        <th>Mark</th>
        <th style="width: 80px;">Quantity</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${unknownItemsHtml}
    </tbody>
  </table>
  `
      : ''
  }
</body>
</html>
  `
}

export async function POST(request: Request) {
  // Check authentication
  const authContext = await getAuthContext()
  if (authContext instanceof NextResponse) {
    return authContext
  }

  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = stockCheckPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Payload validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const html = generateHtmlToPrint(parsed.data)

  // Return HTML that can be printed to PDF
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="stock-check-${parsed.data.date}.html"`,
    },
  })
}
