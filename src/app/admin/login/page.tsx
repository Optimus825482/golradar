'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ── Login Form ──────────────────────────────────────────────────
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/admin';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      const data = await res.json();
      if (data.ok) {
        // Set cookie so middleware guard passes on redirect.
        document.cookie = `admin_token=${data.token}; path=/; max-age=86400; SameSite=Lax`;
        sessionStorage.setItem('admin_token', data.token);
        // If server forces password change, route to dedicated page.
        if (data.mustChange) {
          router.replace('/admin/change-password');
        } else {
          router.replace(nextPath);
        }
      } else {
        setError(data.reason ?? 'Giriş başarısız');
      }
    } catch {
      setError('Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-emerald-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-200 rounded-2xl shadow-xl p-8 w-full max-w-sm"
      >
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-black">
            GR
          </div>
          <h1 className="text-xl font-bold text-gray-800">Gol Radarı · Admin</h1>
          <p className="text-xs text-gray-400 mt-1">Yönetim paneline erişmek için giriş yapın</p>
        </div>

        <div className="mb-3">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Kullanıcı Adı
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
            required
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors"
          />
        </div>

        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Şifre
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
            required
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors"
          />
        </div>

        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50"
        >
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </button>

        {nextPath !== '/admin' && (
          <p className="text-[10px] text-gray-400 text-center mt-3">
            Giriş sonrası yönlendirilecek: <code className="font-mono">{nextPath}</code>
          </p>
        )}
      </form>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────
// Suspense wrapper: useSearchParams requires Suspense boundary in Next 16.
export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}