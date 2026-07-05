'use client';
import { useEffect, useState } from 'react'; import { authFetch } from '@/lib/adminAuth';
interface AuditEntry { id: string; action: string; entity: string; details?: string; userId?: string; createdAt: string; }
export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { authFetch('/api/admin/export?entity=audit&days=30').then(r => r?.json()).then(d => { setLogs(d?.rows ?? []); setLoading(false); }).catch(() => setLoading(false)); }, []);
  return (<div className="p-4 max-w-5xl mx-auto space-y-4"><h1 className="text-xl font-bold">📋 İşlem Kayıtları</h1>{loading && <p className="text-gray-400">Yükleniyor...</p>}{!loading && logs.length === 0 && <p className="text-gray-400">Henüz kayıt yok</p>}<div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-xs"><thead><tr className="bg-gray-50 text-gray-500"><th className="p-2 text-left">Tarih</th><th className="p-2 text-left">İşlem</th><th className="p-2 text-left">Detay</th></tr></thead><tbody>{logs.map(l => (<tr key={l.id} className="border-t hover:bg-gray-50"><td className="p-2 text-gray-500">{new Date(l.createdAt).toLocaleString()}</td><td className="p-2 font-medium">{l.action}</td><td className="p-2 text-gray-600">{l.details}</td></tr>))}</tbody></table></div></div>); }
