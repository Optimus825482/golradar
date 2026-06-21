'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';

// ── Password Change Form ─────────────────────────────────────────
function ChangePasswordForm() {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('Yeni şifre en az 6 karakter olmalı');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Yeni şifreler eşleşmiyor');
      return;
    }
    setLoading(true);
    try {
      const token = sessionStorage.getItem('admin_token');
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'change-password',
          password: currentPassword,
          newPassword,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem('admin_token', data.token);
        router.replace('/admin');
      } else {
        setError(data.reason || 'Şifre değiştirilemedi');
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
          <div className="text-3xl mb-2">🔐</div>
          <h1 className="text-xl font-bold text-gray-800">Şifre Değiştir</h1>
          <p className="text-xs text-gray-400 mt-1">İlk giriş için şifrenizi güncelleyin</p>
        </div>

        <div className="mb-3">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Mevcut Şifre
          </label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>

        <div className="mb-3">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Yeni Şifre
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="En az 6 karakter"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>

        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Yeni Şifre (Tekrar)
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>

        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50"
        >
          {loading ? 'Değiştiriliyor...' : 'Şifreyi Güncelle'}
        </button>
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ChangePasswordForm />
    </Suspense>
  );
}