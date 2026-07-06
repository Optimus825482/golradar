'use client';

import { useState, useEffect, use } from 'react';

interface TraceStep {
  name: string;
  duration: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

const STEP_COLORS: Record<string, string> = {
  fetch_raw_data: 'border-blue-400',
  parse_stats: 'border-indigo-400',
  calculate_pressure: 'border-purple-400',
  pre_checks: 'border-gray-400',
  calculate_goal_probability: 'border-amber-400',
  signal_decision: 'border-orange-500',
  check_and_record_signal: 'border-green-500',
};

const STEP_ICONS: Record<string, string> = {
  fetch_raw_data: '📡',
  parse_stats: '📊',
  calculate_pressure: '🔄',
  pre_checks: '🔍',
  calculate_goal_probability: '🧮',
  signal_decision: '⚡',
  check_and_record_signal: '📈',
};

export default function DebugMatchPage({ params }: { params: Promise<{ matchCode: string }> }) {
  const { matchCode } = use(params);
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<{ traceId: string; steps: TraceStep[]; skipped: boolean } | null>(null);
  const [error, setError] = useState('');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [inputMatchCode, setInputMatchCode] = useState(matchCode || '');

  const startDebug = async (code: string) => {
    if (!code) return;
    setLoading(true);
    setError('');
    setTrace(null);
    try {
      const res = await fetch(`/api/admin/pipeline-trace/start?matchCode=${code}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Unknown error');
      } else if (data.skipped) {
        setTrace({ traceId: '', steps: [], skipped: true });
      } else {
        setTrace({ traceId: data.traceId, steps: data.steps, skipped: false });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (matchCode) {
      setInputMatchCode(matchCode);
      startDebug(matchCode);
    }
  }, [matchCode]);

  const toggleStep = (name: string) => {
    setExpandedStep(expandedStep === name ? null : name);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">🔬 Pipeline Debug</h1>

      {/* Input */}
      <div className="flex gap-3 mb-6">
        <input
          type="number"
          value={inputMatchCode}
          onChange={(e) => setInputMatchCode(e.target.value)}
          placeholder="Maç kodu (ör: 2184558)"
          className="border rounded px-4 py-2 text-sm flex-1 max-w-xs"
          onKeyDown={(e) => e.key === 'Enter' && startDebug(inputMatchCode)}
        />
        <button
          onClick={() => startDebug(inputMatchCode)}
          disabled={loading || !inputMatchCode}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {loading ? '⏳ Çalışıyor...' : '🔍 Debug Başlat'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <span className="text-red-700 text-sm font-medium">Hata: {error}</span>
        </div>
      )}

      {trace?.skipped && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <span className="text-yellow-700 text-sm">
            Maç canlı değil veya eksik veri — pipeline çalıştırılamadı.
          </span>
        </div>
      )}

      {/* Steps timeline */}
      {trace?.steps && trace.steps.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">
              Pipeline Trace — {trace.steps.length} adım
            </h2>
            <span className="text-xs text-gray-400">Trace ID: {trace.traceId.slice(0, 8)}...</span>
          </div>

          {trace.steps.map((step, idx) => {
            const borderColor = STEP_COLORS[step.name] || 'border-gray-300';
            const icon = STEP_ICONS[step.name] || '🔹';
            const isExpanded = expandedStep === `${idx}_${step.name}`;
            const hasError = !!step.error;

            return (
              <div
                key={`${idx}_${step.name}`}
                className={`border-l-4 ${hasError ? 'border-red-500' : borderColor} bg-white rounded-lg shadow-sm overflow-hidden`}
              >
                {/* Header */}
                <button
                  onClick={() => toggleStep(`${idx}_${step.name}`)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{icon}</span>
                    <div>
                      <span className={`text-sm font-mono font-medium ${hasError ? 'text-red-600' : 'text-gray-800'}`}>
                        {hasError ? '❌ ' : ''}{step.name}
                      </span>
                      {step.duration > 0 && (
                        <span className="ml-2 text-xs text-gray-400">{step.duration}ms</span>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                    {hasError && (
                      <div className="bg-red-50 p-2 rounded text-xs text-red-700 mt-2">
                        Hata: {step.error}
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-medium text-gray-500 block mb-1">Input:</span>
                      <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto max-h-40">
                        {JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 block mb-1">Output:</span>
                      <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto max-h-40">
                        {JSON.stringify(step.output, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && !trace && !error && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔬</div>
          <p>Bir maç kodu gir ve Debug Başlat'a bas.</p>
          <p className="text-xs mt-1">Örnek: 2184558, 2180272, 2184554</p>
        </div>
      )}
    </div>
  );
}
