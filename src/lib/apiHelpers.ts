import { NextResponse } from 'next/server'

export function apiError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export function apiSuccess(data: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...data })
}
