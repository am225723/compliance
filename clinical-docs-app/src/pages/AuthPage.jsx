import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Auth state change will handle redirect via App.jsx
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setSuccess('Account created! Check your email to confirm your address, then log in.');
        setMode('login');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        setSuccess('Password reset email sent! Check your inbox.');
      }
    } catch (err) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-teal-700/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-800/15 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo + Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-28 h-28 mb-4 drop-shadow-2xl">
            <img src="/logo.png" alt="Integrative Psychiatry" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Clinical AI</h1>
          <p className="text-sm text-teal-400 font-semibold tracking-widest uppercase mt-1">
            Integrative Psychiatry
          </p>
          <p className="text-xs text-slate-500 mt-2 text-center">
            Dr. Douglas Zelisko, M.D. · Board Certified Psychiatrist
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/50">
          {/* Tab switcher */}
          {mode !== 'reset' && (
            <div className="flex bg-slate-800/60 rounded-xl p-1 mb-6 border border-white/8">
              {['login', 'signup'].map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(''); setSuccess(''); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                    mode === m
                      ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/50'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>
          )}

          {mode === 'reset' && (
            <div className="mb-6">
              <button
                onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                className="text-xs text-teal-400 hover:text-teal-300 font-bold flex items-center gap-1"
              >
                ← Back to Sign In
              </button>
              <h2 className="text-lg font-black text-white mt-3">Reset Password</h2>
              <p className="text-xs text-slate-500 mt-1">We'll send a reset link to your email.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/60 focus:ring-2 focus:ring-teal-500/20 transition-all"
              />
            </div>

            {/* Password (not on reset) */}
            {mode !== 'reset' && (
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                    minLength={mode === 'signup' ? 8 : undefined}
                    className="w-full px-4 py-3 pr-12 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/60 focus:ring-2 focus:ring-teal-500/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setMode('reset'); setError(''); setSuccess(''); }}
                    className="mt-1.5 text-xs text-teal-500 hover:text-teal-400 font-semibold"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-300">{success}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm transition-all shadow-lg shadow-teal-900/40 mt-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          Secure access · HIPAA-conscious design · Data encrypted at rest
        </p>
      </div>
    </div>
  );
}
