import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePos } from '../context/PosContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { printerService } from '../services/printerService.ts';
import {
  Wifi,
  WifiOff,
  Lock,
  LogOut,
  RefreshCw,
  Coins,
  Maximize2,
  Minimize2,
  Clock,
  Calendar,
  UserCheck,
  Printer,
  Globe,
  Menu,
  PauseCircle,
  AlertTriangle,
} from 'lucide-react';

interface HeaderProps {
  onOpenCashRegisterModal: () => void;
  onOpenHeldOrdersModal: () => void;
  onOpenSyncCenter?: () => void;
  onToggleMobileSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCashRegisterModal,
  onOpenHeldOrdersModal,
  onOpenSyncCenter,
  onToggleMobileSidebar,
}) => {
  const { user, logout, lockTerminal } = useAuth();
  const { lang, toggleLang, t, roleLabel } = useLanguage();
  const {
    currentShift,
    isShiftOpen,
    isOnline,
    isNavigatorOnline,
    isServerReachable,
    offlineOrdersCount,
    failedSyncCount,
    conflictsCount,
    isSyncingOffline,
    triggerSync,
    heldOrdersCount,
    setReceiptToPrint,
  } = usePos();

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('fr-FR', { hour12: false }));
      setCurrentDate(now.toLocaleDateString('fr-FR'));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleSyncClick = async () => {
    setIsSyncing(true);
    await triggerSync(true);
    setIsSyncing(false);
  };

  const alertCount = failedSyncCount + conflictsCount;
  const networkLabel = isOnline
    ? t('متصل', 'En ligne')
    : isNavigatorOnline && !isServerReachable
    ? t('الخادم غير متاح', 'Serveur injoignable')
    : t('أوفلاين', 'Hors ligne');

  return (
    <header className="bg-[#222222] border-b border-[#C6A15B]/30 text-[#F7F3EA] px-2.5 sm:px-4 py-2 shadow-lg flex items-center justify-between gap-2 select-none shrink-0 w-full">
      {/* Left / Start: Mobile Menu Toggle + Brand + Employee + Role */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onToggleMobileSidebar && (
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            aria-label={t('فتح القائمة الجانبية', 'Ouvrir le menu')}
            className="lg:hidden p-2 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-[#C6A15B] transition active:scale-95 shrink-0 cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Brand */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#C6A15B] to-[#9E7B38] flex items-center justify-center shadow text-[#171717] font-black text-base sm:text-lg tracking-wider">
            GP
          </div>
          <div className="min-w-0">
            <div className="font-black text-[#C6A15B] text-sm sm:text-base tracking-wider flex items-center gap-1.5 truncate">
              <span>GOLDEN PALACE POS</span>
            </div>
            <div className="text-[11px] text-[#A8A29E] font-medium hidden md:block">
              {t('القصر الذهبي • كاشير المطعم', 'LE PALAIS D’OR • Caisse Restaurant')}
            </div>
          </div>
        </div>

        {/* Employee Name & Role Badge */}
        <div
          className="hidden sm:flex items-center gap-2 bg-[#171717] border border-[#33302B] px-2.5 py-1.5 rounded-xl text-xs shrink-0"
          data-testid="header-employee-info"
        >
          <UserCheck className="w-4 h-4 text-[#C6A15B] shrink-0" />
          <div className="flex items-center gap-1.5 leading-tight">
            <span className="font-bold text-[#F7F3EA] truncate max-w-[130px]">
              {user?.fullName || 'Admin'}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-[#C6A15B]/20 text-[#C6A15B] font-extrabold text-[10px] border border-[#C6A15B]/30">
              {roleLabel(user?.role)}
            </span>
          </div>
        </div>

        {/* Date, Clock & Shift Number */}
        <div className="flex items-center gap-2 sm:gap-3 bg-[#171717] px-2.5 sm:px-3 py-1.5 rounded-xl border border-[#33302B] text-xs font-bold shrink-0">
          <div className="hidden md:flex items-center gap-1.5 text-[#A8A29E]">
            <Calendar className="w-3.5 h-3.5 text-[#C6A15B]" />
            <span className="tabular-nums">{currentDate}</span>
          </div>
          <div className="hidden md:block w-px h-3.5 bg-[#33302B]" />
          <div className="flex items-center gap-1.5 text-[#F7F3EA] font-mono tabular-nums">
            <Clock className="w-3.5 h-3.5 text-[#C6A15B] shrink-0" />
            <span>{currentTime}</span>
          </div>
          {currentShift && (
            <>
              <div className="hidden sm:block w-px h-3.5 bg-[#33302B]" />
              <span className="hidden sm:inline text-[#C6A15B] font-mono font-black tabular-nums">
                #{currentShift.shiftNumber}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right / End Controls: Held Orders, Online/Offline, Printer, Shift, Language, Lock, Logout */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {heldOrdersCount > 0 && (
          <button
            type="button"
            onClick={onOpenHeldOrdersModal}
            className="flex items-center gap-1.5 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-2.5 py-1.5 rounded-xl text-xs font-black transition active:scale-95 cursor-pointer shadow"
            title={t('الفواتير المعلقة', 'Commandes en attente')}
          >
            <PauseCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{t('معلقة:', 'En attente :')}</span>
            <span className="tabular-nums font-black">{heldOrdersCount}</span>
          </button>
        )}

        {/* Online / Offline Status & Sync */}
        <div
          data-testid="network-status-badge"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold ${
            isOnline
              ? 'bg-[#171717] border-emerald-700/60 text-emerald-400'
              : 'bg-red-950/80 border-red-500 text-red-300 animate-pulse'
          }`}
          title={isOnline ? t('متصل بالخادم', 'En ligne') : networkLabel}
        >
          {isOnline ? (
            <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
          )}
          <span
            onClick={onOpenSyncCenter}
            className={`hidden md:inline ${onOpenSyncCenter ? 'cursor-pointer hover:underline' : ''}`}
          >
            {networkLabel}
          </span>

          {offlineOrdersCount > 0 && (
            <button
              type="button"
              data-testid="header-sync-btn"
              onClick={handleSyncClick}
              disabled={isSyncing || isSyncingOffline}
              className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-1.5 py-0.5 rounded-md text-[10px] font-black flex items-center gap-1 cursor-pointer"
              title={t('مزامنة الطلبات غير المتصلة', 'Synchroniser les commandes hors ligne')}
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing || isSyncingOffline ? 'animate-spin' : ''}`} />
              <span className="tabular-nums">{offlineOrdersCount}</span>
            </button>
          )}

          {alertCount > 0 && onOpenSyncCenter && (
            <button
              type="button"
              data-testid="header-conflicts-btn"
              onClick={onOpenSyncCenter}
              className="bg-rose-600 hover:bg-rose-500 text-white px-1.5 py-0.5 rounded-md text-[10px] font-black flex items-center gap-1 cursor-pointer"
              title={t('عرض تعارضات وفشل المزامنة', 'Voir les conflits / échecs sync')}
            >
              <AlertTriangle className="w-3 h-3" />
              <span className="tabular-nums">{alertCount}</span>
            </button>
          )}
        </div>

        {/* Cash Register Shift Button */}
        <button
          type="button"
          onClick={onOpenCashRegisterModal}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-black transition active:scale-95 cursor-pointer ${
            isShiftOpen
              ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-300 hover:bg-emerald-900/60'
              : 'bg-amber-950/60 border-[#C6A15B]/60 text-[#C6A15B] hover:bg-[#C6A15B]/20'
          }`}
          title={isShiftOpen ? t('الصندوق مفتوح', 'Caisse ouverte') : t('فتح الوردية', 'Ouvrir la caisse')}
        >
          <Coins className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">
            {isShiftOpen ? t('الصندوق مفتوح', 'Caisse Ouverte') : t('فتح الوردية', 'Ouvrir Caisse')}
          </span>
        </button>

        {/* Printer Diagnostic */}
        <button
          type="button"
          onClick={() => {
            const p = printerService.getProfile();
            setReceiptToPrint(printerService.generateTestReceiptData(p));
          }}
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#33302B] bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] text-xs font-bold transition cursor-pointer"
          title={t('فحص طابعة الإيصالات 80mm', 'Tester l’imprimante 80mm')}
        >
          <Printer className="w-3.5 h-3.5 text-[#C6A15B]" />
          <span>80mm</span>
        </button>

        {/* Language Toggle AR / FR */}
        <button
          type="button"
          onClick={toggleLang}
          data-testid="language-toggle-btn"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-[#C6A15B]/40 bg-[#171717] hover:bg-[#C6A15B] hover:text-[#171717] text-[#C6A15B] text-xs font-black transition active:scale-95 cursor-pointer"
          title={t('التبديل إلى الفرنسية', 'Passer en arabe')}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{lang === 'ar' ? 'FR' : 'AR'}</span>
        </button>

        {/* Fullscreen */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="hidden sm:flex p-1.5 sm:p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] transition cursor-pointer"
          title={t('ملء الشاشة', 'Plein écran')}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Lock Screen */}
        <button
          type="button"
          onClick={lockTerminal}
          className="p-1.5 sm:p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#C6A15B] transition active:scale-95 cursor-pointer"
          title={t('قفل الشاشة (PIN)', 'Verrouiller (PIN)')}
        >
          <Lock className="w-4 h-4" />
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-950/70 hover:bg-red-900 text-red-200 border border-red-800/70 transition active:scale-95 font-bold text-xs cursor-pointer"
          title={t('تسجيل الخروج', 'Déconnexion')}
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('خروج', 'Quitter')}</span>
        </button>
      </div>
    </header>
  );
};
