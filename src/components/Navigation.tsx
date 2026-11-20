import React from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { usePos } from '../context/PosContext.tsx';
import {
  ShoppingCart,
  Grid,
  ClipboardList,
  ChefHat,
  UtensilsCrossed,
  Package,
  Users,
  Truck,
  Coins,
  Receipt,
  BarChart3,
  Settings,
  ShieldCheck,
  FileSpreadsheet,
  AlertTriangle,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { Role } from '../types.ts';

export type ActiveTab =
  | 'pos'
  | 'tables'
  | 'orders'
  | 'kitchen'
  | 'sync'
  | 'menu'
  | 'menu-import'
  | 'inventory'
  | 'waste'
  | 'purchases'
  | 'suppliers'
  | 'customers'
  | 'delivery'
  | 'caisse'
  | 'expenses'
  | 'reports'
  | 'audit'
  | 'settings';

interface NavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface NavItemConfig {
  id: ActiveTab;
  labelAr: string;
  labelFr: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles: Role[];
  group: 'CORE' | 'OPERATIONS';
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const { hasRole } = useAuth();
  const { t, isRtl } = useLanguage();
  const { offlineOrdersCount, failedSyncCount, conflictsCount } = usePos();

  const navItems: NavItemConfig[] = [
    // CORE PHASE 3 CASHIER SECTIONS
    {
      id: 'pos',
      labelAr: 'الكاشير',
      labelFr: 'Caisse POS',
      shortcut: 'F2',
      icon: ShoppingCart,
      allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
      group: 'CORE',
    },
    {
      id: 'tables',
      labelAr: 'الطاولات',
      labelFr: 'Tables',
      icon: Grid,
      allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
      group: 'CORE',
    },
    {
      id: 'orders',
      labelAr: 'الطلبات',
      labelFr: 'Commandes',
      icon: ClipboardList,
      allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
      group: 'CORE',
    },
    {
      id: 'kitchen',
      labelAr: 'المطبخ',
      labelFr: 'Cuisine (KDS)',
      icon: ChefHat,
      allowedRoles: ['ADMIN', 'MANAGER', 'KITCHEN', 'CASHIER'],
      group: 'CORE',
    },
    {
      id: 'sync',
      labelAr: 'مركز المزامنة',
      labelFr: 'Centre Sync',
      icon: RefreshCw,
      allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
      group: 'CORE',
    },
    {
      id: 'menu',
      labelAr: 'المنتجات',
      labelFr: 'Produits & Prix',
      shortcut: 'F3',
      icon: UtensilsCrossed,
      allowedRoles: ['ADMIN', 'MANAGER'],
      group: 'CORE',
    },
    {
      id: 'menu-import',
      labelAr: 'استيراد القائمة',
      labelFr: 'Import Menu',
      icon: Upload,
      allowedRoles: ['ADMIN', 'OWNER'],
      group: 'CORE',
    },
    {
      id: 'reports',
      labelAr: 'التقارير',
      labelFr: 'Rapports',
      shortcut: 'F10',
      icon: BarChart3,
      allowedRoles: ['ADMIN', 'MANAGER'],
      group: 'CORE',
    },
    {
      id: 'settings',
      labelAr: 'الإعدادات',
      labelFr: 'Paramètres',
      icon: Settings,
      allowedRoles: ['ADMIN'],
      group: 'CORE',
    },
    // OPERATIONS & BACKOFFICE MODULES (PRESERVED WITH RBAC)
    {
      id: 'caisse',
      labelAr: 'الصندوق والورديات',
      labelFr: 'Gestion Caisse',
      shortcut: 'F12',
      icon: Coins,
      allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER'],
      group: 'OPERATIONS',
    },
    {
      id: 'delivery',
      labelAr: 'التوصيل المنزلي',
      labelFr: 'Livraisons',
      icon: Truck,
      allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER'],
      group: 'OPERATIONS',
    },
    {
      id: 'customers',
      labelAr: 'الزبائن',
      labelFr: 'Clients',
      shortcut: 'F5',
      icon: Users,
      allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER'],
      group: 'OPERATIONS',
    },
    {
      id: 'inventory',
      labelAr: 'المخزون والجرد',
      labelFr: 'Stock',
      icon: Package,
      allowedRoles: ['ADMIN', 'MANAGER', 'INVENTORY'],
      group: 'OPERATIONS',
    },
    {
      id: 'waste',
      labelAr: 'الهدر والتالف',
      labelFr: 'Pertes',
      icon: AlertTriangle,
      allowedRoles: ['ADMIN', 'MANAGER', 'INVENTORY', 'KITCHEN'],
      group: 'OPERATIONS',
    },
    {
      id: 'purchases',
      labelAr: 'المشتريات',
      labelFr: 'Achats',
      shortcut: 'F1',
      icon: FileSpreadsheet,
      allowedRoles: ['ADMIN', 'MANAGER', 'INVENTORY'],
      group: 'OPERATIONS',
    },
    {
      id: 'expenses',
      labelAr: 'المصاريف',
      labelFr: 'Dépenses',
      icon: Receipt,
      allowedRoles: ['ADMIN', 'MANAGER'],
      group: 'OPERATIONS',
    },
    {
      id: 'audit',
      labelAr: 'سجل العمليات',
      labelFr: 'Journal Audit',
      icon: ShieldCheck,
      allowedRoles: ['ADMIN'],
      group: 'OPERATIONS',
    },
  ];

  const visibleCore = navItems.filter((i) => i.group === 'CORE' && hasRole(i.allowedRoles));
  const visibleOps = navItems.filter((i) => i.group === 'OPERATIONS' && hasRole(i.allowedRoles));

  const renderNavButton = (item: NavItemConfig) => {
    const isActive = activeTab === item.id;
    const Icon = item.icon;
    const syncAlertCount = item.id === 'sync' ? Math.max(offlineOrdersCount, conflictsCount) : 0;
    const hasCriticalSync = item.id === 'sync' && (failedSyncCount > 0 || conflictsCount > 0);
    return (
      <button
        key={item.id}
        type="button"
        data-testid={`nav-tab-${item.id}`}
        onClick={() => {
          onTabChange(item.id);
          onCloseMobile?.();
        }}
        className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer active:scale-[0.98] ${
          isActive
            ? 'bg-[#C6A15B] text-[#171717] shadow-lg font-black'
            : 'text-[#F7F3EA] hover:bg-[#171717] hover:text-[#C6A15B] border border-transparent hover:border-[#C6A15B]/30'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#171717]' : 'text-[#C6A15B]'}`} />
          <span className="truncate">{t(item.labelAr, item.labelFr)}</span>
        </div>
        {syncAlertCount > 0 ? (
          <span
            className={`text-[10px] font-mono font-black px-1.5 py-0.5 rounded tabular-nums ${
              hasCriticalSync
                ? 'bg-rose-600 text-white'
                : isActive
                ? 'bg-[#171717]/20 text-[#171717]'
                : 'bg-[#C6A15B]/20 text-[#C6A15B] border border-[#C6A15B]/40'
            }`}
          >
            {syncAlertCount}
          </span>
        ) : (
          item.shortcut && (
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                isActive
                  ? 'bg-[#171717]/20 text-[#171717]'
                  : 'bg-[#171717] text-[#A8A29E] border border-[#33302B]'
              }`}
            >
              {item.shortcut}
            </span>
          )
        )}
      </button>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#222222] text-[#F7F3EA] select-none">
      {/* Mobile drawer top bar */}
      <div className="lg:hidden flex items-center justify-between p-3.5 border-b border-[#33302B]">
        <span className="font-black text-[#C6A15B] tracking-wider">GOLDEN PALACE POS</span>
        <button
          type="button"
          onClick={onCloseMobile}
          className="p-1.5 rounded-lg bg-[#171717] text-[#A8A29E] hover:text-[#F7F3EA]"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-2.5 space-y-4">
        {/* Core POS Sections */}
        <div className="space-y-1">
          <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#A8A29E]">
            {t('القائمة الرئيسية', 'Navigation Principale')}
          </div>
          {visibleCore.map(renderNavButton)}
        </div>

        {/* Operations / Management Sections */}
        {visibleOps.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-[#33302B]">
            <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#A8A29E]">
              {t('الإدارة والعمليات', 'Gestion & Opérations')}
            </div>
            {visibleOps.map(renderNavButton)}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Vertical Sidebar */}
      <aside
        data-testid="desktop-sidebar"
        className={`hidden lg:flex flex-col w-60 shrink-0 bg-[#222222] h-full overflow-hidden ${
          isRtl ? 'border-l border-[#33302B]' : 'border-r border-[#33302B]'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile / Tablet Slide-Over Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside
            className={`relative z-10 w-72 max-w-[85vw] h-full bg-[#222222] shadow-2xl ${
              isRtl ? 'border-l border-[#C6A15B]/40' : 'border-r border-[#C6A15B]/40'
            }`}
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};
