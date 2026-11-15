import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api, setAuthToken } from '../services/api.ts';
import { Lock, Globe, KeyRound, ShieldCheck } from 'lucide-react';

export const LoginModal: React.FC = () => {
  const { login, pinLogin, unlockWithPin, isLocked, user } = useAuth();
  const { lang, toggleLang, t } = useLanguage();
  const [mode, setMode] = useState<'PIN' | 'PASSWORD' | 'SETUP_ADMIN'>('PIN');
  const [pin, setPin] = useState<string>('');
  const [identifier, setIdentifier] = useState<string>('admin');
  const [password, setPassword] = useState<string>('admin123');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDesktopMode, setIsDesktopMode] = useState<boolean>(false);

  // First-Run Initial Admin Setup (when desktop database has zero users)
  const [setupFullName, setSetupFullName] = useState<string>('');
  const [setupUsername, setSetupUsername] = useState<string>('admin');
  const [setupEmail, setSetupEmail] = useState<string>('');
  const [setupPassword, setSetupPassword] = useState<string>('');
  const [setupPin, setSetupPin] = useState<string>('');

  useEffect(() => {
    if (isLocked) return;
    const isDesktopOrProdBuild = Boolean(window.goldenPalaceDesktop?.isDesktop || import.meta.env?.PROD);
    if (!isDesktopOrProdBuild) return;
    if (typeof api.getFirstRunStatus !== 'function') return;
    api
      .getFirstRunStatus()
      .then((res) => {
        if (res?.isDesktop || (res as any)?.isProductionMode) {
          setIsDesktopMode(true);
          setPassword('');
        }
        if (res?.needsInitialAdminSetup) {
          setMode('SETUP_ADMIN');
        }
      })
      .catch(() => {
        // Ignore when offline or mocked
      });
  }, [isLocked]);

  const handleNumpad = async (char: string) => {
    setError('');
    if (char === 'C') {
      setPin('');
      return;
    }

    if (pin.length < 6) {
      const nextPin = pin + char;
      setPin(nextPin);

      if (nextPin.length === 4) {
        setIsLoading(true);
        try {
          if (isLocked) {
            const success = await unlockWithPin(nextPin);
            if (!success) {
              setError(t('رمز PIN غير صحيح', 'Code PIN incorrect'));
              setPin('');
            }
          } else {
            await pinLogin(nextPin);
          }
        } catch (err: any) {
          setError(err.message || t('رمز PIN غير صحيح', 'Code PIN incorrect'));
          setPin('');
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) return;
    setIsLoading(true);
    setError('');
    try {
      await login(identifier, password);
    } catch (err: any) {
      setError(err.message || t('بيانات الدخول غير صحيحة', 'Identifiants incorrects'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleInitialAdminSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const res = await api.setupInitialAdmin({
        fullName: setupFullName.trim(),
        username: setupUsername.trim(),
        email: setupEmail.trim() || undefined,
        password: setupPassword,
        pin: setupPin.trim(),
      });
      if (res?.token) {
        setAuthToken(res.token);
        window.location.reload();
      }
    } catch (err: any) {
      setError(err?.message || t('فشل إنشاء حساب المدير الأول', 'Échec configuration administrateur'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] bg-[#171717]/95 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none overflow-y-auto">
      <div className="relative bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-5 sm:p-8 shadow-2xl space-y-5 text-center text-[#F7F3EA] max-h-[96vh] overflow-y-auto no-scrollbar my-auto">
        {/* Language Toggle */}
        <button
          type="button"
          onClick={toggleLang}
          className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#171717] border border-[#C6A15B]/40 text-[#C6A15B] hover:bg-[#C6A15B] hover:text-[#171717] text-xs font-black transition cursor-pointer"
          title={t('تبديل اللغة للفرنسية', 'Passer en arabe')}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{lang === 'ar' ? 'FR' : 'AR'}</span>
        </button>

        {/* Brand Header */}
        <div className="space-y-1.5 pt-2">
          <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#C6A15B] to-[#9E7B38] flex items-center justify-center shadow-lg text-[#171717] font-black text-2xl mb-3 tracking-wider border border-[#F7F3EA]/20">
            GP
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-[#C6A15B] tracking-wider">
            GOLDEN PALACE POS
          </h1>
          <h2 className="text-sm sm:text-base font-bold text-[#F7F3EA]">
            {t('مطعم القصر الذهبي • LE PALAIS D’OR', 'LE PALAIS D’OR • Restaurant Gastronomique')}
          </h2>
          <p className="text-xs font-medium text-[#A8A29E]">
            {t('شارع بلهوشات، حسين داي، الجزائر العاصمة', 'Hussein Dey, Alger — Système Caisse & Gestion')}
          </p>
        </div>

        {isLocked && user && (
          <div className="p-3.5 rounded-2xl bg-[#C6A15B]/15 border border-[#C6A15B]/50 text-[#F7F3EA] text-sm font-bold flex items-center justify-center gap-2">
            <Lock className="w-5 h-5 text-[#C6A15B] shrink-0" />
            <span>
              {t(`الشاشة مقفلة للمستخدم: ${user.fullName}`, `Écran verrouillé: ${user.fullName}`)}
            </span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-2xl bg-red-950/70 border border-red-500/60 text-red-200 text-sm font-bold animate-shake">
            {error}
          </div>
        )}

        {mode === 'SETUP_ADMIN' ? (
          <form onSubmit={handleInitialAdminSetup} className="space-y-3 text-start">
            <div className="p-3 rounded-2xl bg-[#171717] border border-[#C6A15B]/50 text-xs text-[#C6A15B] font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>
                {t(
                  'التشغيل الأول للنظام: قم بإنشاء حساب المدير العام الخاص بك (بدون كلمة مرور أو PIN افتراضي).',
                  'Premier démarrage : créez votre compte Administrateur sécurisé.'
                )}
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                {t('الاسم الكامل:', 'Nom complet :')}
              </label>
              <input
                type="text"
                required
                value={setupFullName}
                onChange={(e) => setSetupFullName(e.target.value)}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2.5 text-sm font-bold text-[#F7F3EA]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                  {t('اسم المستخدم:', 'Identifiant :')}
                </label>
                <input
                  type="text"
                  required
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2.5 text-sm font-mono font-bold text-[#F7F3EA]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                  {t('رمز PIN شخصي (4-12):', 'Code PIN (4-12) :')}
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  maxLength={12}
                  value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value)}
                  placeholder="••••"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2.5 text-sm font-mono font-bold text-[#C6A15B] text-center"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                {t('البريد الإلكتروني (اختياري):', 'Email (optionnel) :')}
              </label>
              <input
                type="email"
                value={setupEmail}
                onChange={(e) => setSetupEmail(e.target.value)}
                placeholder="admin@goldenpalace.dz"
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2.5 text-sm font-mono text-[#F7F3EA]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                {t('كلمة المرور (8 أحرف على الأقل):', 'Mot de passe (8 car. min) :')}
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2.5 text-sm font-mono text-[#F7F3EA]"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-xl cursor-pointer"
            >
              {isLoading
                ? t('جاري التهيئة...', 'Configuration...')
                : t('إنشاء حساب المدير وبدء التشغيل', 'Créer Admin & Démarrer')}
            </button>
          </form>
        ) : mode === 'PIN' ? (
          <div className="space-y-5">
            {/* PIN Dots Display */}
            <div className="flex items-center justify-center gap-4 py-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${
                    pin.length > i
                      ? 'bg-[#C6A15B] border-[#C6A15B] scale-125 shadow-[0_0_12px_rgba(198,161,91,0.6)]'
                      : 'border-[#A8A29E]/40 bg-[#171717]'
                  }`}
                />
              ))}
            </div>

            {/* Quick PIN Helper (hidden in desktop production mode) */}
            {!isDesktopMode && (
              <div className="text-xs font-semibold text-[#A8A29E] bg-[#171717] py-1.5 px-3 rounded-xl border border-[#33302B] inline-flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-[#C6A15B]" />
                <span>
                  {t('PIN الافتراضي:', 'PIN par défaut :')}{' '}
                  <span className="font-black text-[#C6A15B] tabular-nums">1234</span> (Admin) •{' '}
                  <span className="font-black text-[#C6A15B] tabular-nums">1111</span> ({t('كاشير', 'Caissier')})
                </span>
              </div>
            )}

            {/* Touch Numpad */}
            <div className="grid grid-cols-3 gap-3 max-w-[290px] mx-auto font-mono">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (k === '⌫') setPin(pin.slice(0, -1));
                    else handleNumpad(k);
                  }}
                  disabled={isLoading}
                  className={`h-14 rounded-2xl font-black text-2xl transition flex items-center justify-center border active:scale-95 cursor-pointer shadow-sm ${
                    k === 'C'
                      ? 'bg-red-950/60 border-red-800/70 text-red-300 hover:bg-red-900/70'
                      : k === '⌫'
                      ? 'bg-[#171717] border-[#33302B] text-[#C6A15B] hover:border-[#C6A15B]'
                      : 'bg-[#171717] hover:bg-[#2A2620] border-[#33302B] hover:border-[#C6A15B] active:bg-[#C6A15B] active:text-[#171717] text-[#F7F3EA]'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>

            {!isLocked && (
              <button
                type="button"
                onClick={() => setMode('PASSWORD')}
                className="text-sm text-[#C6A15B] hover:underline pt-1 inline-block font-bold cursor-pointer"
              >
                {t('تسجيل الدخول باسم المستخدم وكلمة المرور', 'Connexion par identifiant et mot de passe')}
              </button>
            )}
          </div>
        ) : (
          /* USERNAME / PASSWORD MODE */
          <form onSubmit={handlePasswordSubmit} className="space-y-4 text-start">
            <div>
              <label className="block text-sm font-bold text-[#A8A29E] mb-1.5">
                {t('اسم المستخدم أو البريد الإلكتروني:', 'Identifiant ou Email :')}
              </label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-3 text-base font-bold text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-[#A8A29E] mb-1.5">
                {t('كلمة المرور:', 'Mot de passe :')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-3 text-base font-bold text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-lg rounded-2xl shadow-xl active:scale-95 transition cursor-pointer"
            >
              {isLoading ? t('جاري التحقق...', 'Vérification...') : t('تسجيل الدخول', 'Se connecter')}
            </button>

            <button
              type="button"
              onClick={() => setMode('PIN')}
              className="w-full text-center text-sm text-[#C6A15B] hover:underline font-bold pt-1 cursor-pointer"
            >
              {t('← العودة لتسجيل الدخول السريع برمز PIN', '← Retour au code PIN rapide')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
