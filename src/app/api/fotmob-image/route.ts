import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Proxy FotMob images to avoid DNS resolution issues on client
const IMAGE_CACHE = new Map<string, { data: Buffer; contentType: string; timestamp: number }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'team' // team | player
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
  }

  const cacheKey = `${type}/${id}`
  const cached = IMAGE_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return new NextResponse(new Uint8Array(cached.data), {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  }

  const fotmobUrl = type === 'player'
    ? `https://media.fotmob.com/images/player/${id}`
    : `https://media.fotmob.com/images/team/${id}`

  try {
    const resp = await fetch(fotmobUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      cache: 'no-store',
    })

    if (!resp.ok) {
      return NextResponse.json({ error: 'Image not found' }, { status: resp.status })
    }

    const contentType = resp.headers.get('content-type') || 'image/png'
    const data = Buffer.from(await resp.arrayBuffer())

    IMAGE_CACHE.set(cacheKey, { data, contentType, timestamp: Date.now() })

    // Clean old cache entries
    if (IMAGE_CACHE.size > 500) {
      const now = Date.now()
      for (const [key, value] of IMAGE_CACHE) {
        if (now - value.timestamp > CACHE_TTL) IMAGE_CACHE.delete(key)
      }
    }

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
  }
}
