import React, { useEffect, useState } from 'react';
import { getDoctor, DoctorResponse, DoctorDiagnostic } from '../api';
import { ShieldAlert, CheckCircle, XCircle, Heart, Loader } from 'lucide-react';

interface DoctorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DoctorModal({ isOpen, onClose }: DoctorModalProps) {
  const [data, setData] = useState<DoctorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDoctor();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to complete doctor analysis.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runDiagnostics();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-b flex items-center justify-center p-4 z-50 font-sans">
      <div className="w-full max-w-lg bg-[#1E1F20] border border-[#2A2C2E] rounded-lg overflow-hidden shadow-2xl relative">
        <div className="absolute top-0 left-0 w-full h-[3px] bg-[#4F8CFF]" />

        {/* Title row */}
        <div className="p-4 border-b border-[#2A2C2E] flex items-center justify-between bg-zinc-850">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-red-500 fill-red-500 animate-pulse" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">SYSTEM DOCTOR DIAGNOSTIC</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Content list */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto bg-[#0F1115]">
          {loading && (
            <div className="text-gray-400 py-12 flex flex-col items-center justify-center gap-3">
              <Loader className="w-6 h-6 text-[#4F8CFF] animate-spin" />
              <span className="text-xs">Running E2E tests, verifying caching buffers...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-950/40 border border-red-900/50 p-4 rounded text-red-400 text-xs flex gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && data && (
            <div className="space-y-3">
              <div className="text-[11px] text-gray-500 font-medium mb-1">
                E2E System test report summary:
              </div>

              {data.diagnostics.map((diag, index) => (
                <div 
                  key={index}
                  className="p-3 bg-[#1E1F20] border border-[#2A2C2E] rounded flex items-start gap-3 hover:border-zinc-700 transition-colors"
                >
                  {diag.status === 'pass' ? (
                    <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  )}
                  
                  <div className="space-y-1">
                    <div className="text-white font-bold text-xs">{diag.title}</div>
                    <div className="text-xs text-gray-400 font-mono leading-relaxed select-text">{diag.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom bar controls */}
        <div className="p-4 border-t border-[#2A2C2E] bg-zinc-850 flex items-center justify-between">
          <span className="text-[10px] text-zinc-550">
            ecysearch v1.0.0 · Local-First E2E Guard
          </span>
          
          <button
            onClick={runDiagnostics}
            disabled={loading}
            className="bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-3 py-1.5 rounded text-xs transition-colors"
          >
            Re-run Diagnostic
          </button>
        </div>
      </div>
    </div>
  );
}
