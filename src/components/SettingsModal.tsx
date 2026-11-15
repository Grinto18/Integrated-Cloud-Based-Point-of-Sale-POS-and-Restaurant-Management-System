import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePos } from '../context/PosContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import { printerService } from '../services/printerService.ts';
import {
  ArabicEscPosEncoding,
  BackupManifestEntry,
  BackupsOverviewResponse,
  DesktopRuntimeStatus,
  PrinterConnectionType,
  PrinterProfile,
  PrintJobRecord,
  Role,
  SystemPrinterInfo,
  User as PosUser,
} from '../types.ts';
import {
  Settings,
  X,
  Database,
  Printer,
  Shield,
  Save,
  Download,
  Plus,
  Key,
  Sliders,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  FileText,
  Edit2,
  UserCheck,
  UserX,
  RefreshCw,
  HardDrive,
  ShieldCheck,
  History,
} from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const { hasRole } = useAuth();
  const { setReceiptToPrint, openCashDrawer, refreshSettings } = usePos();
  const { t, setLang, roleLabel } = useLanguage();
  const isAdmin = hasRole(['ADMIN']);

  const [activeTab, setActiveTab] = useState<'GENERAL' | 'STAFF' | 'PRINTER' | 'BACKUP'>('GENERAL');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [staffUsers, setStaffUsers] = useState<PosUser[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Printer Profile State
  const [printerProfile, setPrinterProfile] = useState<PrinterProfile>(printerService.getProfile());
  const [confirmMenuReset, setConfirmMenuReset] = useState<boolean>(false);
  const [isResettingMenu, setIsResettingMenu] = useState<boolean>(false);

  // Staff Modals
  const [showAddStaffModal, setShowAddStaffModal] = useState<boolean>(false);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newFullName, setNewFullName] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [newPin, setNewPin] = useState<string>('');
  const [newPhone, setNewPhone] = useState<string>('');
  const [newRole, setNewRole] = useState<Role>('CASHIER');

  const [editingUser, setEditingUser] = useState<PosUser | null>(null);
  const [editFullName, setEditFullName] = useState<string>('');
  const [editEmail, setEditEmail] = useState<string>('');
  const [editPhone, setEditPhone] = useState<string>('');
  const [editRole, setEditRole] = useState<Role>('CASHIER');
  const [editIsActive, setEditIsActive] = useState<boolean>(true);

  const [pinResetUser, setPinResetUser] = useState<PosUser | null>(null);
  const [pinResetValue, setPinResetValue] = useState<string>('');
  const [staffModalError, setStaffModalError] = useState<string | null>(null);
  const [isSavingStaff, setIsSavingStaff] = useState<boolean>(false);

  // Phase 07 Backup & Disaster Recovery State
  const [backupOverview, setBackupOverview] = useState<BackupsOverviewResponse | null>(null);
  const [isLoadingBackups, setIsLoadingBackups] = useState<boolean>(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [verifyingFilename, setVerifyingFilename] = useState<string | null>(null);
  const [downloadingFilename, setDownloadingFilename] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupManifestEntry | null>(null);
  const [restoreStep, setRestoreStep] = useState<0 | 1 | 2>(0);
  const [isRestoringBackup, setIsRestoringBackup] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Phase 09 Printer Discovery, Tests & Persistent Print Queue State
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinterInfo[]>([]);
  const [supportedConnections, setSupportedConnections] = useState<PrinterConnectionType[]>([
    'WINDOWS_SPOOLER',
    'NETWORK_IP',
    'USB',
    'BROWSER',
  ]);
  const [printJobsList, setPrintJobsList] = useState<PrintJobRecord[]>([]);
  const [isLoadingPrinters, setIsLoadingPrinters] = useState<boolean>(false);
  const [isLoadingPrintJobs, setIsLoadingPrintJobs] = useState<boolean>(false);
  const [runningTestType, setRunningTestType] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<number | null>(null);

  // Phase 09 Desktop Runtime & Safe Update Guard State
  const [desktopStatus, setDesktopStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [preUpdateResult, setPreUpdateResult] = useState<any | null>(null);
  const [isCheckingPreUpdate, setIsCheckingPreUpdate] = useState<boolean>(false);

  useEffect(() => {
    loadInitial();
  }, []);

  useEffect(() => {
    if (activeTab === 'BACKUP' && isAdmin) {
      loadBackups();
      loadDesktopStatus();
    } else if (activeTab === 'PRINTER') {
      loadPrinterDiagnostics();
    }
  }, [activeTab, isAdmin]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback((c) => (c?.text === text ? null : c)), 4500);
  };

  const loadInitial = async () => {
    setIsLoading(true);
    try {
      await Promise.all([loadSettings(), loadStaff()]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      if (data && typeof data === 'object') {
        setSettings(data);
        setPrinterProfile(printerService.applySettingsProfile(data));
      }
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تحميل الإعدادات', 'Échec du chargement des paramètres'));
    }
  };

  const loadStaff = async () => {
    try {
      const u = await api.getUsers();
      setStaffUsers(Array.isArray(u) ? u : []);
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تحميل الموظفين', 'Échec du chargement du personnel'));
    }
  };

  const handleSaveSettings = async (overridePayload?: Record<string, string>) => {
    setIsSavingSettings(true);
    try {
      const payload = overridePayload || settings;
      await api.updateSettings(payload);
      if (payload.default_language === 'ar' || payload.default_language === 'fr') {
        setLang(payload.default_language);
      }
      await refreshSettings();
      showToast('success', t('تم حفظ الإعدادات وتطبيقها بنجاح', 'Paramètres enregistrés et appliqués avec succès'));
    } catch (err: any) {
      showToast('error', err?.message || t('فشل حفظ الإعدادات', 'Échec de l’enregistrement des paramètres'));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSavePrinterSettings = async () => {
    printerService.saveProfile(printerProfile);
    const printerUpdates: Record<string, string> = {
      printer_name: printerProfile.printerName,
      printer_driver: printerProfile.driver,
      printer_connection_type: printerProfile.connectionType || 'WINDOWS_SPOOLER',
      printer_network_ip: printerProfile.networkIp || '',
      printer_network_port: String(printerProfile.networkPort || 9100),
      printer_arabic_encoding: printerProfile.arabicEncoding || 'CP864',
      paper_type: printerProfile.paperType,
      printable_width: String(printerProfile.printableWidth),
      printer_copies: String(printerProfile.copies),
      print_method: printerProfile.printMethod,
      printer_feed_after: String(printerProfile.feedAfter),
      printer_cut_paper: String(printerProfile.cutPaper),
      printer_cash_drawer: String(printerProfile.cashDrawer),
      receipt_size: printerProfile.paperType,
    };
    const merged = { ...settings, ...printerUpdates };
    setSettings(merged);
    await handleSaveSettings(merged);
  };

  const loadPrinterDiagnostics = async () => {
    setIsLoadingPrinters(true);
    setIsLoadingPrintJobs(true);
    try {
      const [statusRes, jobsRes, electronPrinters] = await Promise.all([
        typeof api.getPrinterStatus === 'function' ? api.getPrinterStatus().catch(() => null) : Promise.resolve(null),
        typeof api.getPrintJobs === 'function' ? api.getPrintJobs({ limit: 40 }).catch(() => []) : Promise.resolve([]),
        window.goldenPalaceDesktop?.getPrinters ? window.goldenPalaceDesktop.getPrinters().catch(() => []) : Promise.resolve([]),
      ]);

      const mergedPrinters: SystemPrinterInfo[] = [];
      const seenNames = new Set<string>();
      for (const p of [...(statusRes?.printers || []), ...(electronPrinters || [])]) {
        const name = String(p?.name || '').trim();
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          mergedPrinters.push({
            name,
            driverName: p.driverName || p.displayName,
            portName: p.portName,
            status: p.status !== undefined ? String(p.status) : undefined,
            isDefault: Boolean(p.isDefault),
            connectionType: (p.connectionType as PrinterConnectionType) || 'WINDOWS_SPOOLER',
          });
        }
      }
      setSystemPrinters(mergedPrinters);
      if (Array.isArray(statusRes?.supportedConnections) && statusRes.supportedConnections.length > 0) {
        setSupportedConnections(statusRes.supportedConnections);
      }
      if (Array.isArray(jobsRes)) {
        setPrintJobsList(jobsRes);
      }
    } finally {
      setIsLoadingPrinters(false);
      setIsLoadingPrintJobs(false);
    }
  };

  const handleRunPrinterTest = async (testType: 'STANDARD' | 'ARABIC' | 'FEED_CUT') => {
    setRunningTestType(testType);
    try {
      const connectionType = printerProfile.connectionType || 'WINDOWS_SPOOLER';
      const res = await api.testPrinter({
        testType,
        printerName: printerProfile.printerName,
        connectionType,
        targetIp: printerProfile.networkIp || null,
        targetPort: printerProfile.networkPort || 9100,
        paperWidth: printerProfile.paperType === '58mm' ? '58mm' : '80mm',
        arabicEncoding: printerProfile.arabicEncoding || 'CP864',
      });
      await loadPrinterDiagnostics();
      showToast(
        'success',
        res?.transportResult?.message ||
          t(`تم إرسال اختبار الطباعة (${testType}) بنجاح`, `Test d’impression (${testType}) envoyé`)
      );
    } catch (err: any) {
      await loadPrinterDiagnostics();
      showToast('error', err?.message || t('فشل اختبار الطابعة', 'Échec du test imprimante'));
    } finally {
      setRunningTestType(null);
    }
  };

  const handleRetryPrintJob = async (jobId: number) => {
    setRetryingJobId(jobId);
    try {
      await api.retryPrintJob(jobId);
      await loadPrinterDiagnostics();
      showToast('success', t(`تمت إعادة إرسال مهمة الطباعة #${jobId}`, `Tâche #${jobId} réessayée`));
    } catch (err: any) {
      await loadPrinterDiagnostics();
      showToast('error', err?.message || t('فشلت إعادة المحاولة', 'Échec de la tentative'));
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleReprintFromQueue = async (jobId: number) => {
    setRetryingJobId(jobId);
    try {
      await api.reprintPrintJob(jobId, {
        printerName: printerProfile.printerName,
        connectionType: printerProfile.connectionType || 'WINDOWS_SPOOLER',
      });
      await loadPrinterDiagnostics();
      showToast('success', t('تمت إعادة طباعة نسخة DUPLICATA بنجاح', 'Duplicata réimprimé avec succès'));
    } catch (err: any) {
      await loadPrinterDiagnostics();
      showToast('error', err?.message || t('فشل إعادة الطباعة', 'Échec de réimpression'));
    } finally {
      setRetryingJobId(null);
    }
  };

  const loadDesktopStatus = async () => {
    if (typeof api.getDesktopStatus !== 'function') return;
    try {
      const ds = await api.getDesktopStatus();
      if (ds && typeof ds === 'object') {
        setDesktopStatus(ds);
      }
    } catch {
      // Ignore if unavailable in older mock
    }
  };

  const handlePreUpdateCheck = async () => {
    setIsCheckingPreUpdate(true);
    try {
      const res = await api.runPreUpdateCheck();
      setPreUpdateResult(res);
      await Promise.all([loadBackups(), loadDesktopStatus()]);
      showToast('success', t('تم إنشاء نسخة ما قبل التحديث والتحقق من الجاهزية بنجاح', 'Système prêt pour mise à jour avec sauvegarde vérifiée'));
    } catch (err: any) {
      showToast('error', err?.message || t('يوجد عمليات مالية مفتوحة تمنع التحديث الآن', 'Opérations financières ouvertes bloquant la mise à jour'));
      await loadDesktopStatus();
    } finally {
      setIsCheckingPreUpdate(false);
    }
  };

  const handleCreateStaff = async () => {
    setStaffModalError(null);
    if (!newUsername.trim() || !newFullName.trim() || !newPassword.trim()) {
      setStaffModalError(t('الاسم الكامل واسم المستخدم وكلمة المرور مطلوبة', 'Nom, identifiant et mot de passe requis'));
      return;
    }
    if (newPin.trim() && (newPin.trim().length < 4 || newPin.trim().length > 12)) {
      setStaffModalError(t('رمز PIN يجب أن يتكون من 4 إلى 12 خانة', 'Le code PIN doit contenir entre 4 et 12 caractères'));
      return;
    }
    setIsSavingStaff(true);
    try {
      await api.createUser({
        username: newUsername.trim(),
        email: newEmail.trim() || `${newUsername.trim()}@goldenpalace.dz`,
        fullName: newFullName.trim(),
        password: newPassword,
        pin: newPin.trim() || undefined,
        phone: newPhone.trim() || undefined,
        role: newRole,
      });
      setShowAddStaffModal(false);
      setNewUsername('');
      setNewEmail('');
      setNewFullName('');
      setNewPassword('');
      setNewPin('');
      setNewPhone('');
      await loadStaff();
      showToast('success', t('تم إنشاء حساب الموظف بنجاح', 'Compte employé créé'));
    } catch (err: any) {
      setStaffModalError(err?.message || t('فشل إنشاء المستخدم', 'Échec de création'));
    } finally {
      setIsSavingStaff(false);
    }
  };

  const handleUpdateStaff = async () => {
    if (!editingUser) return;
    setStaffModalError(null);
    if (!editFullName.trim() || !editEmail.trim()) {
      setStaffModalError(t('الاسم الكامل والبريد الإلكتروني مطلوبان', 'Nom complet et email requis'));
      return;
    }
    setIsSavingStaff(true);
    try {
      await api.updateUser(editingUser.id, {
        fullName: editFullName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim() || null,
        role: editRole,
        isActive: editIsActive,
      });
      setEditingUser(null);
      await loadStaff();
      showToast('success', t('تم تحديث بيانات الموظف بنجاح', 'Employé mis à jour'));
    } catch (err: any) {
      setStaffModalError(err?.message || t('فشل تحديث الموظف', 'Échec de mise à jour'));
    } finally {
      setIsSavingStaff(false);
    }
  };

  const handleResetPin = async () => {
    if (!pinResetUser) return;
    setStaffModalError(null);
    const trimmed = pinResetValue.trim();
    if (trimmed.length < 4 || trimmed.length > 12) {
      setStaffModalError(t('رمز PIN يجب أن يتكون من 4 إلى 12 خانة', 'Le code PIN doit contenir entre 4 et 12 caractères'));
      return;
    }
    setIsSavingStaff(true);
    try {
      await api.updateUser(pinResetUser.id, { pin: trimmed });
      setPinResetUser(null);
      setPinResetValue('');
      await loadStaff();
      showToast('success', t('تم تحديث رمز PIN بشكل مشفر بنجاح', 'Code PIN réinitialisé et chiffré'));
    } catch (err: any) {
      setStaffModalError(err?.message || t('فشل تعيين رمز PIN', 'Échec de réinitialisation du PIN'));
    } finally {
      setIsSavingStaff(false);
    }
  };

  const handleToggleUserActive = async (u: PosUser) => {
    try {
      await api.updateUser(u.id, { isActive: !u.isActive });
      await loadStaff();
      showToast(
        'success',
        !u.isActive
          ? t(`تم تفعيل حساب ${u.fullName}`, `Compte ${u.fullName} activé`)
          : t(`تم تعطيل حساب ${u.fullName}`, `Compte ${u.fullName} désactivé`)
      );
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تغيير حالة الحساب', 'Échec de changement de statut'));
    }
  };

  const formatBytes = (bytes: number) => {
    const val = Number(bytes || 0);
    if (val < 1024) return `${val} B`;
    if (val < 1024 * 1024) return `${(val / 1024).toFixed(1)} KB`;
    return `${(val / (1024 * 1024)).toFixed(2)} MB`;
  };

  const loadBackups = async () => {
    if (!isAdmin || typeof api.getBackups !== 'function') return;
    setIsLoadingBackups(true);
    try {
      const overview = await api.getBackups();
      if (overview && typeof overview === 'object' && Array.isArray(overview.backups)) {
        setBackupOverview(overview);
      }
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تحميل النسخ الاحتياطية', 'Échec du chargement des sauvegardes'));
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleCreateSqliteBackup = async () => {
    setIsCreatingBackup(true);
    try {
      const res = await api.createSqliteBackup('MANUAL');
      await loadBackups();
      showToast(
        'success',
        t(
          `تم إنشاء نسخة احتياطية والتحقق من سلامتها: ${res?.backup?.filename || ''}`,
          `Sauvegarde créée et vérifiée : ${res?.backup?.filename || ''}`
        )
      );
    } catch (err: any) {
      showToast('error', err?.message || t('فشل إنشاء النسخة الاحتياطية', 'Échec de la création de sauvegarde'));
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleVerifySqliteBackup = async (filename: string) => {
    setVerifyingFilename(filename);
    try {
      const res = await api.verifySqliteBackup(filename);
      await loadBackups();
      if (res?.verification?.valid) {
        showToast(
          'success',
          t(
            `النسخة ${filename} سليمة (integrity_check: ok)`,
            `Sauvegarde ${filename} vérifiée (integrity_check: ok)`
          )
        );
      } else {
        showToast(
          'error',
          res?.verification?.error || t(`النسخة ${filename} تالفة أو غير صالحة`, `Sauvegarde ${filename} corrompue`)
        );
      }
    } catch (err: any) {
      showToast('error', err?.message || t('فشل فحص النسخة الاحتياطية', 'Échec de vérification'));
    } finally {
      setVerifyingFilename(null);
    }
  };

  const handleDownloadSqliteBackup = async (filename: string) => {
    setDownloadingFilename(filename);
    try {
      await api.downloadSqliteBackup(filename);
      showToast('success', t(`تم تحميل ملف ${filename} بنجاح`, `Fichier ${filename} téléchargé`));
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تحميل ملف النسخة الاحتياطية', 'Échec du téléchargement'));
    } finally {
      setDownloadingFilename(null);
    }
  };

  const openRestoreWarning = (entry: BackupManifestEntry) => {
    setRestoreTarget(entry);
    setRestoreError(null);
    setRestoreStep(1);
  };

  const closeRestoreModals = () => {
    if (isRestoringBackup) return;
    setRestoreStep(0);
    setRestoreTarget(null);
    setRestoreError(null);
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    setIsRestoringBackup(true);
    setRestoreError(null);
    try {
      const result = await api.restoreSqliteBackup(restoreTarget.filename, 'CONFIRM_RESTORE');
      setRestoreStep(0);
      setRestoreTarget(null);
      await Promise.all([loadBackups(), loadSettings(), loadStaff(), refreshSettings()]);
      showToast(
        'success',
        t(
          `تمت استعادة قاعدة البيانات من ${result.restoredFrom} بنجاح (نسخة الأمان السابقة: ${result.preRestoreBackup})`,
          `Base restaurée depuis ${result.restoredFrom} (snapshot sécurité : ${result.preRestoreBackup})`
        )
      );
    } catch (err: any) {
      const msg = err?.message || t('فشلت عملية الاستعادة', 'Échec de la restauration');
      setRestoreError(msg);
      showToast('error', msg);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const backup = await api.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = `golden_palace_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url);
      showToast('success', t('تم تصدير النسخة الاحتياطية بنجاح', 'Sauvegarde exportée avec succès'));
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تصدير النسخة الاحتياطية', 'Échec de l’exportation'));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-3 sm:space-y-4">
      {/* Header and Tab switcher */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5">
          <div className="font-black text-base sm:text-xl text-[#F7F3EA] flex items-center gap-2 sm:pe-3 sm:border-e sm:border-[#33302B]">
            <div className="w-9 h-9 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B]">
              <Settings className="w-5 h-5" />
            </div>
            <span className="whitespace-nowrap">{t('إعدادات النظام والصلاحيات', 'Paramètres Système & RBAC')}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#171717] p-1 rounded-xl border border-[#33302B] text-xs sm:text-sm overflow-x-auto no-scrollbar w-full sm:w-auto">
            {[
              { id: 'GENERAL' as const, label: t('الإعدادات العامة', 'Général') },
              { id: 'STAFF' as const, label: t('الموظفين والأدوار (RBAC)', 'Personnel & RBAC') },
              { id: 'PRINTER' as const, label: t('الطابعة والفواتير', 'Imprimante') },
              { id: 'BACKUP' as const, label: t('النسخ الاحتياطي', 'Sauvegarde') },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-black transition cursor-pointer whitespace-nowrap shrink-0 ${
                  activeTab === tab.id ? 'bg-[#C6A15B] text-[#171717]' : 'text-[#A8A29E] hover:text-[#F7F3EA]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={loadInitial}
            className="p-2.5 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-[#A8A29E] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#C6A15B]' : ''}`} />
          </button>

          {activeTab === 'GENERAL' && isAdmin && (
            <button
              type="button"
              disabled={isSavingSettings}
              onClick={() => handleSaveSettings()}
              className="bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black transition flex items-center gap-2 shadow-lg cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingSettings ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ الإعدادات', 'Enregistrer')}</span>
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-between gap-2 shrink-0 ${
            feedback.type === 'error'
              ? 'bg-rose-950/60 border-rose-600/60 text-rose-200'
              : 'bg-emerald-950/60 border-emerald-600/60 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 bg-[#222222] rounded-2xl border border-[#33302B] p-4 sm:p-6 shadow-lg">
        {/* TAB 1: GENERAL */}
        {activeTab === 'GENERAL' && (
          <div className="max-w-3xl space-y-5 text-xs sm:text-sm font-bold">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('اسم المطعم:', 'Nom du restaurant :')}</label>
                <input
                  type="text"
                  value={settings['restaurant_name'] ?? 'GOLDEN PALACE POS'}
                  onChange={(e) => setSettings({ ...settings, restaurant_name: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('العلامة التجارية / الفرع:', 'Enseigne / Filiale :')}</label>
                <input
                  type="text"
                  value={settings['restaurant_brand'] ?? 'مطعم القصر الذهبي • عند الجيجلي'}
                  onChange={(e) => setSettings({ ...settings, restaurant_brand: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الهاتف الرسمي للمطعم:', 'Téléphone officiel :')}</label>
                <input
                  type="text"
                  value={settings['restaurant_phone'] ?? '0550123456'}
                  onChange={(e) => setSettings({ ...settings, restaurant_phone: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('العملة:', 'Devise :')}</label>
                <input
                  type="text"
                  value={settings['currency'] ?? 'DZD'}
                  onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#C6A15B] font-mono font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('اللغة الافتراضية للنظام:', 'Langue par défaut :')}</label>
                <select
                  value={settings['default_language'] ?? 'ar'}
                  onChange={(e) => setSettings({ ...settings, default_language: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="ar">العربية (RTL)</option>
                  <option value="fr">Français (LTR)</option>
                </select>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('نسبة الضريبة (% TVA):', 'Taux de TVA (%) :')}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={settings['tax_rate'] ?? '0'}
                  onChange={(e) => setSettings({ ...settings, tax_rate: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#C6A15B] font-mono tabular-nums font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[#A8A29E] text-xs mb-1">{t('العنوان الكامل:', 'Adresse complète :')}</label>
              <textarea
                rows={2}
                value={settings['restaurant_address'] ?? 'شارع بلهوشات، حسين داي، الجزائر العاصمة'}
                onChange={(e) => setSettings({ ...settings, restaurant_address: e.target.value })}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
              />
            </div>

            {/* Inventory & Receipt Preferences */}
            <div className="pt-4 border-t border-[#33302B] space-y-3">
              <h4 className="font-black text-sm text-[#C6A15B]">{t('إعدادات المخزون والفواتير:', 'Stock & Tickets :')}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center gap-2.5 bg-[#171717] border border-[#33302B] rounded-xl p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(settings['low_stock_alert_enabled'] ?? 'true') !== 'false'}
                    onChange={(e) =>
                      setSettings({ ...settings, low_stock_alert_enabled: String(e.target.checked) })
                    }
                    className="accent-[#C6A15B] w-4 h-4"
                  />
                  <span className="text-xs font-bold">{t('تفعيل تنبيهات نقص المخزون', 'Activer alertes stock faible')}</span>
                </label>

                <label className="flex items-center gap-2.5 bg-[#171717] border border-[#33302B] rounded-xl p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(settings['auto_deduct_stock'] ?? 'true') !== 'false'}
                    onChange={(e) =>
                      setSettings({ ...settings, auto_deduct_stock: String(e.target.checked) })
                    }
                    className="accent-[#C6A15B] w-4 h-4"
                  />
                  <span className="text-xs font-bold">{t('خصم المكونات تلقائياً عند الطلب', 'Déduction auto des recettes')}</span>
                </label>

                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('عتبة التنبيه الافتراضية:', 'Seuil d’alerte global :')}</label>
                  <input
                    type="number"
                    min="0"
                    value={settings['low_stock_alert_threshold'] ?? '5'}
                    onChange={(e) => setSettings({ ...settings, low_stock_alert_threshold: e.target.value })}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('تذييل الفاتورة:', 'Pied de ticket :')}</label>
                  <input
                    type="text"
                    value={settings['receipt_footer'] ?? 'شكراً لزيارتكم • Merci de votre visite'}
                    onChange={(e) => setSettings({ ...settings, receipt_footer: e.target.value })}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA]"
                  />
                </div>
              </div>
            </div>

            {isAdmin && (
              <div className="pt-4 border-t border-[#33302B] space-y-2">
                {!confirmMenuReset ? (
                  <button
                    type="button"
                    onClick={() => setConfirmMenuReset(true)}
                    className="py-2.5 px-4 bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] font-black rounded-xl border border-[#33302B] text-xs flex items-center gap-2 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>{t('إعادة مزامنة قائمة مطعم القصر الذهبي الافتراضية', 'Réinitialiser le menu standard')}</span>
                  </button>
                ) : (
                  <div className="p-3 bg-amber-950/40 border border-amber-600/50 rounded-2xl space-y-2">
                    <p className="text-xs font-black text-amber-200">
                      {t(
                        'سيتم تحديث قائمة الطعام فقط (لن يتم حذف الطلبات أو الفواتير أو المدفوعات). هل تريد المتابعة؟',
                        'Seul le menu sera actualisé (commandes et paiements intacts). Continuer ?'
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isResettingMenu}
                        onClick={async () => {
                          setIsResettingMenu(true);
                          try {
                            const res = await api.resetGrineMenu('CONFIRM_MENU_RESET');
                            showToast('success', res.message);
                            setConfirmMenuReset(false);
                          } catch (err: any) {
                            showToast('error', err?.message || t('فشل تحديث القائمة', 'Échec'));
                          } finally {
                            setIsResettingMenu(false);
                          }
                        }}
                        className="px-4 py-2 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black rounded-xl text-xs cursor-pointer"
                      >
                        {isResettingMenu ? t('جاري التحديث...', 'En cours...') : t('تأكيد تحديث القائمة', 'Confirmer')}
                      </button>
                      <button
                        type="button"
                        disabled={isResettingMenu}
                        onClick={() => setConfirmMenuReset(false)}
                        className="px-4 py-2 bg-[#171717] border border-[#33302B] text-[#F7F3EA] font-bold rounded-xl text-xs cursor-pointer"
                      >
                        {t('إلغاء', 'Annuler')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: STAFF (RBAC) */}
        {activeTab === 'STAFF' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs sm:text-sm text-[#A8A29E] font-bold">
                {t(
                  'إدارة الموظفين، الأدوار الوظيفية وحالة الحساب (تُحفظ رموز PIN بشكل مشفر ولا تُعرض أبداً)',
                  'Gestion du personnel, rôles et statuts (codes PIN chiffrés, jamais affichés)'
                )}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setStaffModalError(null);
                    setShowAddStaffModal(true);
                  }}
                  className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-black transition flex items-center gap-1.5 shadow-lg cursor-pointer self-end sm:self-auto"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>{t('إضافة موظف جديد', 'Nouvel employé')}</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#33302B]">
              <table className="w-full text-start text-sm">
                <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase">
                  <tr>
                    <th className="p-3.5">{t('الاسم الكامل', 'Nom complet')}</th>
                    <th className="p-3.5">{t('المستخدم / البريد', 'Identifiant / Email')}</th>
                    <th className="p-3.5">{t('الدور', 'Rôle')}</th>
                    <th className="p-3.5">{t('رمز PIN', 'Code PIN')}</th>
                    <th className="p-3.5">{t('الحالة', 'Statut')}</th>
                    {isAdmin && <th className="p-3.5 text-center">{t('إجراءات', 'Actions')}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#33302B] font-bold">
                  {staffUsers.map((u) => {
                    const active = u.isActive !== false;
                    return (
                      <tr key={u.id} className="hover:bg-[#171717]/70 transition">
                        <td className="p-3.5">
                          <div className="font-black text-[#F7F3EA] text-base">{u.fullName}</div>
                          {u.phone && <div className="text-xs font-mono text-[#A8A29E]">{u.phone}</div>}
                        </td>
                        <td className="p-3.5">
                          <div className="text-[#C6A15B] font-mono">{u.username}</div>
                          <div className="text-xs text-[#A8A29E]">{u.email}</div>
                        </td>
                        <td className="p-3.5">
                          <span
                            title={roleLabel(u.role)}
                            className="bg-[#171717] text-[#C6A15B] border border-[#C6A15B]/40 px-2.5 py-1 rounded-xl text-xs font-black font-mono"
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono text-xs">
                          {u.hasPin ? (
                            <span className="text-emerald-300 bg-emerald-950/60 border border-emerald-600/50 px-2.5 py-1 rounded-lg">
                              {t('•••• (مفعّل)', '•••• (Actif)')}
                            </span>
                          ) : (
                            <span className="text-[#A8A29E]">—</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-xl text-xs font-black border ${
                              active
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50'
                                : 'bg-rose-950/60 text-rose-300 border-rose-600/50'
                            }`}
                          >
                            {active ? t('نشط', 'Actif') : t('معطل', 'Désactivé')}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setStaffModalError(null);
                                  setEditingUser(u);
                                  setEditFullName(u.fullName);
                                  setEditEmail(u.email);
                                  setEditPhone(u.phone || '');
                                  setEditRole(u.role);
                                  setEditIsActive(active);
                                }}
                                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-[#F7F3EA] cursor-pointer"
                                title={t('تعديل بيانات الموظف', 'Modifier employé')}
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setStaffModalError(null);
                                  setPinResetUser(u);
                                  setPinResetValue('');
                                }}
                                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-[#C6A15B] cursor-pointer"
                                title={t('إعادة تعيين رمز PIN', 'Réinitialiser PIN')}
                              >
                                <Key className="w-4 h-4" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleUserActive(u)}
                                className={`p-2 rounded-xl border cursor-pointer ${
                                  active
                                    ? 'bg-rose-950/40 border-rose-700/50 text-rose-400 hover:bg-rose-950'
                                    : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-400 hover:bg-emerald-950'
                                }`}
                                title={active ? t('تعطيل الحساب', 'Désactiver') : t('تفعيل الحساب', 'Activer')}
                              >
                                {active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Role Permission Matrix */}
            <div className="bg-[#171717] border border-[#33302B] rounded-2xl p-4 space-y-2">
              <div className="text-xs font-black text-[#C6A15B] flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                <span>{t('مصفوفة صلاحيات الأدوار (RBAC)', 'Matrice des permissions (RBAC)')}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-[#A8A29E]">
                <div><strong className="text-[#F7F3EA]">ADMIN:</strong> {t('كامل الصلاحيات، الإعدادات، التدقيق، الموظفون', 'Accès complet, paramètres, audit, staff')}</div>
                <div><strong className="text-[#F7F3EA]">MANAGER:</strong> {t('التقارير، القوائم، الخصومات، الصندوق، المخزون', 'Rapports, menu, remises, caisse, stock')}</div>
                <div><strong className="text-[#F7F3EA]">CASHIER:</strong> {t('شاشة البيع، التحصيل، الصندوق، التوصيل', 'Caisse, encaissements, tiroir, livraison')}</div>
                <div><strong className="text-[#F7F3EA]">WAITER:</strong> {t('الطاولات، إنشاء الطلبات، إرسال للمطبخ', 'Tables, prise de commandes, cuisine')}</div>
                <div><strong className="text-[#F7F3EA]">KITCHEN:</strong> {t('شاشة المطبخ، تحديث تحضير الأطباق', 'Écran cuisine, suivi préparation')}</div>
                <div><strong className="text-[#F7F3EA]">INVENTORY:</strong> {t('المخزون، المشتريات، الموردون، الهدر', 'Stocks, achats, fournisseurs, pertes')}</div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PRINTER */}
        {activeTab === 'PRINTER' && (
          <div className="max-w-5xl space-y-5 text-sm font-bold">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#171717] p-5 rounded-2xl border border-[#33302B] space-y-4 md:col-span-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#222222] border border-[#C6A15B]/40 text-[#C6A15B] flex items-center justify-center">
                      <Printer className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-black text-base text-[#F7F3EA]">{printerProfile.printerName}</h4>
                      <p className="text-xs text-[#A8A29E]">
                        {printerProfile.connectionType || 'WINDOWS_SPOOLER'} • {printerProfile.driver} •{' '}
                        {printerProfile.paperType}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={loadPrinterDiagnostics}
                      className="px-2.5 py-1.5 rounded-xl bg-[#222222] border border-[#33302B] hover:border-[#C6A15B] text-xs text-[#A8A29E] flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPrinters ? 'animate-spin text-[#C6A15B]' : ''}`} />
                      <span>{t('اكتشاف الطابعات', 'Détecter')}</span>
                    </button>
                    <span className="text-xs bg-[#222222] text-[#C6A15B] font-mono font-black px-3 py-1.5 rounded-xl border border-[#33302B]">
                      {printerProfile.printableWidth} mm
                    </span>
                  </div>
                </div>

                {/* Detected Windows / System Printers List */}
                <div className="bg-[#222222] border border-[#33302B] rounded-xl p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#C6A15B] font-black">
                      {t('الطابعات المتاحة في النظام:', 'Imprimantes détectées sur le système :')}
                    </span>
                    <span className="text-[11px] text-[#A8A29E] font-mono">
                      {systemPrinters.length > 0
                        ? t(`${systemPrinters.length} طابعة مكتشفة`, `${systemPrinters.length} détectée(s)`)
                        : t('لا توجد طابعات Windows Spooler مكتشفة في هذه البيئة', 'Aucune imprimante Windows détectée')}
                    </span>
                  </div>
                  {systemPrinters.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {systemPrinters.map((sp) => (
                        <button
                          key={sp.name}
                          type="button"
                          onClick={() => {
                            const updated: PrinterProfile = {
                              ...printerProfile,
                              printerName: sp.name,
                              driver: sp.driverName || printerProfile.driver,
                              connectionType: 'WINDOWS_SPOOLER',
                              printMethod: 'ESCPOS_RAW',
                            };
                            setPrinterProfile(updated);
                            printerService.saveProfile(updated);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono cursor-pointer transition ${
                            printerProfile.printerName === sp.name
                              ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B] font-black'
                              : 'bg-[#171717] text-[#F7F3EA] border-[#33302B] hover:border-[#C6A15B]/60'
                          }`}
                        >
                          {sp.name} {sp.isDefault ? '★' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#33302B] text-xs">
                  <div>
                    <label className="text-[#A8A29E] block mb-1">{t('اسم الطابعة:', 'Nom imprimante :')}</label>
                    <input
                      type="text"
                      value={printerProfile.printerName}
                      onChange={(e) => {
                        const updated = { ...printerProfile, printerName: e.target.value };
                        setPrinterProfile(updated);
                        printerService.saveProfile(updated);
                      }}
                      className="w-full bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2 text-[#C6A15B] font-black"
                    />
                  </div>
                  <div>
                    <label className="text-[#A8A29E] block mb-1">Driver / Modèle:</label>
                    <input
                      type="text"
                      value={printerProfile.driver}
                      onChange={(e) => {
                        const updated = { ...printerProfile, driver: e.target.value };
                        setPrinterProfile(updated);
                        printerService.saveProfile(updated);
                      }}
                      className="w-full bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2 text-[#F7F3EA]"
                    />
                  </div>
                  <div>
                    <label className="text-[#A8A29E] block mb-1">{t('عدد النسخ:', 'Copies :')}</label>
                    <input
                      type="number"
                      min="1"
                      max="5"
                      value={printerProfile.copies || 1}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 1));
                        const updated = { ...printerProfile, copies: val };
                        setPrinterProfile(updated);
                        printerService.saveProfile(updated);
                      }}
                      className="w-full bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2 text-center text-[#C6A15B] font-mono tabular-nums font-black"
                    />
                  </div>
                </div>

                {/* Supported Connection Types (Provable paths only - NO Bluetooth) */}
                <div className="space-y-2 pt-3 border-t border-[#33302B] text-xs">
                  <label className="text-[#A8A29E] block">
                    {t('نوع الاتصال المدعوم بالطابعة:', 'Type de connexion imprimante :')}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        { id: 'WINDOWS_SPOOLER', label: 'Windows Spooler' },
                        { id: 'NETWORK_IP', label: t('شبكة LAN (TCP 9100)', 'Réseau IP (9100)') },
                        { id: 'USB', label: 'USB (Web Serial)' },
                        { id: 'BROWSER', label: 'Browser / Electron' },
                      ] as const
                    ).map((conn) => {
                      const active = (printerProfile.connectionType || 'WINDOWS_SPOOLER') === conn.id;
                      const isAvailableOnHost = supportedConnections.includes(conn.id);
                      return (
                        <button
                          key={conn.id}
                          type="button"
                          data-testid={`conn-type-${conn.id}`}
                          onClick={() => {
                            const updated: PrinterProfile = {
                              ...printerProfile,
                              connectionType: conn.id,
                              printMethod: conn.id === 'BROWSER' ? 'BROWSER' : 'ESCPOS_RAW',
                            };
                            setPrinterProfile(updated);
                            printerService.saveProfile(updated);
                          }}
                          className={`p-2.5 rounded-xl border font-black cursor-pointer text-center ${
                            active
                              ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                              : 'bg-[#222222] text-[#A8A29E] border-[#33302B] hover:border-[#C6A15B]/40'
                          }`}
                        >
                          <div>{conn.label}</div>
                          {!isAvailableOnHost && (
                            <div className="text-[10px] opacity-75">
                              {t('(متاح على Windows)', '(Windows requis)')}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {printerProfile.connectionType === 'NETWORK_IP' && (
                    <div className="grid grid-cols-3 gap-2 pt-2">
                      <div className="col-span-2">
                        <label className="text-[#A8A29E] block mb-1">
                          {t('عنوان IP للطابعة الشبكية:', 'Adresse IP imprimante :')}
                        </label>
                        <input
                          type="text"
                          placeholder="192.168.1.200"
                          value={printerProfile.networkIp || ''}
                          onChange={(e) => {
                            const updated = { ...printerProfile, networkIp: e.target.value };
                            setPrinterProfile(updated);
                            printerService.saveProfile(updated);
                          }}
                          className="w-full bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2 font-mono text-[#F7F3EA]"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="text-[#A8A29E] block mb-1">Port TCP:</label>
                        <input
                          type="number"
                          value={printerProfile.networkPort || 9100}
                          onChange={(e) => {
                            const updated = {
                              ...printerProfile,
                              networkPort: Math.max(1, Math.min(65535, Number(e.target.value) || 9100)),
                            };
                            setPrinterProfile(updated);
                            printerService.saveProfile(updated);
                          }}
                          className="w-full bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2 font-mono text-[#C6A15B] text-center"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Paper Width & Arabic ESC/POS Encoding */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[#33302B] text-xs">
                  <div>
                    <label className="text-[#A8A29E] block mb-1.5">{t('مقاس الورق:', 'Format papier :')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['80mm', '58mm'] as const).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          data-testid={`paper-size-${sz}`}
                          onClick={() => {
                            const updated = {
                              ...printerProfile,
                              paperType: sz,
                              paperWidth: sz === '80mm' ? 80 : 58,
                              printableWidth: sz === '80mm' ? 70 : 48,
                            };
                            setPrinterProfile(updated);
                            printerService.saveProfile(updated);
                          }}
                          className={`p-2.5 rounded-xl border font-black cursor-pointer ${
                            printerProfile.paperType === sz
                              ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                              : 'bg-[#222222] text-[#A8A29E] border-[#33302B]'
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[#A8A29E] block mb-1.5">
                      {t('ترميز العربية ESC/POS:', 'Encodage Arabe ESC/POS :')}
                    </label>
                    <select
                      value={printerProfile.arabicEncoding || 'CP864'}
                      onChange={(e) => {
                        const updated = {
                          ...printerProfile,
                          arabicEncoding: e.target.value as ArabicEscPosEncoding,
                        };
                        setPrinterProfile(updated);
                        printerService.saveProfile(updated);
                      }}
                      className="w-full bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2.5 text-[#F7F3EA] font-mono font-black"
                    >
                      <option value="CP864">CP864 (IBM Arabic — موصى به)</option>
                      <option value="WINDOWS_1256">Windows-1256 (Arabic ANSI)</option>
                      <option value="UTF8">UTF-8 (Modern Thermal)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Quick Actions & Diagnostic Tests */}
              <div className="bg-[#171717] p-4 rounded-2xl border border-[#33302B] flex flex-col justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setReceiptToPrint(printerService.generateTestReceiptData(printerProfile))}
                  className="w-full py-2.5 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>{t('طباعة تذكرة فحص', 'Imprimer ticket test')}</span>
                </button>

                <button
                  type="button"
                  data-testid="test-printer-standard-btn"
                  disabled={runningTestType !== null}
                  onClick={() => handleRunPrinterTest('STANDARD')}
                  className="w-full py-2 bg-[#222222] hover:border-[#C6A15B] text-[#F7F3EA] font-black rounded-xl text-xs flex items-center justify-center gap-2 border border-[#33302B] cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-[#C6A15B]" />
                  <span>
                    {runningTestType === 'STANDARD'
                      ? t('جاري الاختبار...', 'Test en cours...')
                      : t('اختبار الطباعة', 'Test standard')}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="test-printer-arabic-btn"
                  disabled={runningTestType !== null}
                  onClick={() => handleRunPrinterTest('ARABIC')}
                  className="w-full py-2 bg-[#222222] hover:border-[#C6A15B] text-[#F7F3EA] font-black rounded-xl text-xs flex items-center justify-center gap-2 border border-[#33302B] cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-[#C6A15B]" />
                  <span>
                    {runningTestType === 'ARABIC'
                      ? t('جاري اختبار العربية...', 'Test Arabe...')
                      : t('اختبار العربية (AR/FR)', 'Test Arabe (AR/FR)')}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="test-printer-feedcut-btn"
                  disabled={runningTestType !== null}
                  onClick={() => handleRunPrinterTest('FEED_CUT')}
                  className="w-full py-2 bg-[#222222] hover:border-[#C6A15B] text-[#F7F3EA] font-black rounded-xl text-xs flex items-center justify-center gap-2 border border-[#33302B] cursor-pointer"
                >
                  <Sliders className="w-4 h-4 text-[#C6A15B]" />
                  <span>
                    {runningTestType === 'FEED_CUT'
                      ? t('جاري اختبار القطع...', 'Test coupe...')
                      : t('اختبار صفحة فارغة / قطع الورق', 'Test avance & coupe')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const last = printerService.getLastReceipt();
                    setReceiptToPrint(last || printerService.generateTestReceiptData(printerProfile));
                  }}
                  className="w-full py-2 bg-[#222222] hover:border-[#C6A15B] text-[#F7F3EA] font-black rounded-xl text-xs flex items-center justify-center gap-2 border border-[#33302B] cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-[#C6A15B]" />
                  <span>{t('إعادة طباعة آخر إيصال', 'Réimprimer dernier ticket')}</span>
                </button>

                <button
                  type="button"
                  onClick={openCashDrawer}
                  className="w-full py-2 bg-[#222222] hover:border-[#C6A15B] text-[#F7F3EA] font-black rounded-xl text-xs flex items-center justify-center gap-2 border border-[#33302B] cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-[#C6A15B]" />
                  <span>{t('اختبار درج النقود', 'Tester tiroir-caisse')}</span>
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    data-testid="save-printer-settings-btn"
                    disabled={isSavingSettings}
                    onClick={handleSavePrinterSettings}
                    className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white font-black rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t('حفظ في قاعدة البيانات', 'Enregistrer en base')}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Calibration widths */}
            <div className="bg-[#171717] p-4 rounded-2xl border border-[#33302B] space-y-3">
              <h4 className="font-black text-sm text-[#C6A15B] flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                <span>{t('معايرة عرض الطباعة الحرارية (58mm / 80mm)', 'Calibration largeur imprimante (mm)')}</span>
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                {[48, 50, 68, 70, 72, 74, 80].map((w) => {
                  const selected = printerProfile.printableWidth === w;
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => {
                        const paper = w <= 54 ? '58mm' : '80mm';
                        const updated: PrinterProfile = {
                          ...printerProfile,
                          paperType: paper,
                          paperWidth: w <= 54 ? 58 : 80,
                          printableWidth: w,
                        };
                        setPrinterProfile(updated);
                        printerService.saveProfile(updated);
                      }}
                      className={`p-2.5 rounded-xl border font-mono text-xs font-black cursor-pointer transition ${
                        selected
                          ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                          : 'bg-[#222222] text-[#A8A29E] border-[#33302B] hover:border-[#C6A15B]/50'
                      }`}
                    >
                      {w} mm {w === 70 ? '★' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Persistent Print Jobs Queue (Task 04) */}
            <div className="bg-[#171717] p-4 rounded-2xl border border-[#33302B] space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="font-black text-sm text-[#C6A15B] flex items-center gap-2">
                  <History className="w-4 h-4" />
                  <span>{t('طابور وسجل مهام الطباعة (print_jobs)', 'File & historique d’impression (print_jobs)')}</span>
                </h4>
                <button
                  type="button"
                  onClick={loadPrinterDiagnostics}
                  className="px-3 py-1.5 rounded-xl bg-[#222222] border border-[#33302B] hover:border-[#C6A15B] text-xs font-bold text-[#A8A29E] flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPrintJobs ? 'animate-spin text-[#C6A15B]' : ''}`} />
                  <span>{t('تحديث الطابور', 'Actualiser')}</span>
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#33302B]">
                <table className="w-full text-start text-xs">
                  <thead className="bg-[#222222] text-[#A8A29E] border-b border-[#33302B] font-black">
                    <tr>
                      <th className="p-2.5">{t('الطلب', 'Bon')}</th>
                      <th className="p-2.5">{t('النوع', 'Type')}</th>
                      <th className="p-2.5">{t('الطابعة / الاتصال', 'Imprimante')}</th>
                      <th className="p-2.5">{t('الحالة', 'Statut')}</th>
                      <th className="p-2.5">{t('المحاولات', 'Essais')}</th>
                      <th className="p-2.5 text-center">{t('إجراءات', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#33302B]">
                    {printJobsList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-[#A8A29E]">
                          {t('لا توجد مهام طباعة مسجلة بعد.', 'Aucune tâche d’impression enregistrée.')}
                        </td>
                      </tr>
                    ) : (
                      printJobsList.map((job) => {
                        const statusClass =
                          job.status === 'PRINTED'
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50'
                            : job.status === 'FAILED'
                            ? 'bg-rose-950/60 text-rose-300 border-rose-600/50'
                            : 'bg-amber-950/60 text-amber-300 border-amber-600/50';
                        return (
                          <tr key={job.id} className="hover:bg-[#222222]/50">
                            <td className="p-2.5 font-mono">
                              <div className="text-[#F7F3EA] font-black">{job.orderNumber}</div>
                              {job.isReprint && (
                                <span className="text-[10px] text-[#C6A15B]">DUPLICATA</span>
                              )}
                            </td>
                            <td className="p-2.5 font-mono text-[#A8A29E]">
                              {job.jobType} ({job.paperWidth})
                            </td>
                            <td className="p-2.5">
                              <div className="text-[#F7F3EA]">{job.printerName}</div>
                              <div className="text-[10px] font-mono text-[#A8A29E]">
                                {job.connectionType}
                                {job.targetIp ? ` (${job.targetIp}:${job.targetPort || 9100})` : ''}
                              </div>
                              {job.errorMessage && (
                                <div className="text-[10px] text-rose-300 mt-0.5 max-w-xs break-words">
                                  {job.errorMessage}
                                </div>
                              )}
                            </td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-lg border text-[11px] font-black ${statusClass}`}>
                                {job.status}
                              </span>
                              <div className="text-[10px] text-[#A8A29E] mt-0.5">
                                {job.confirmedAt
                                  ? t('مؤكد ورقياً', 'Confirmé')
                                  : job.spoolerAccepted
                                  ? t('مقبول Spooler', 'Spooler OK')
                                  : t('غير مؤكد', 'Non confirmé')}
                              </div>
                            </td>
                            <td className="p-2.5 font-mono text-center text-[#C6A15B]">{job.attempts}</td>
                            <td className="p-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                {(job.status === 'FAILED' || job.status === 'PENDING') && (
                                  <button
                                    type="button"
                                    disabled={retryingJobId === job.id}
                                    onClick={() => handleRetryPrintJob(job.id)}
                                    className="px-2.5 py-1 rounded-lg bg-[#C6A15B] text-[#171717] font-black text-[11px] cursor-pointer"
                                  >
                                    {t('إعادة المحاولة', 'Réessayer')}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={retryingJobId === job.id}
                                  onClick={() => handleReprintFromQueue(job.id)}
                                  className="px-2.5 py-1 rounded-lg bg-[#222222] border border-[#33302B] hover:border-[#C6A15B] text-[#C6A15B] font-black text-[11px] cursor-pointer"
                                >
                                  {t('إعادة طباعة', 'Réimprimer')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: BACKUP & DISASTER RECOVERY */}
        {activeTab === 'BACKUP' && (
          <div className="space-y-5 text-sm">
            {!isAdmin ? (
              <div className="p-6 bg-[#171717] rounded-2xl border border-[#33302B] flex items-center gap-3 text-[#A8A29E]">
                <Shield className="w-6 h-6 text-[#C6A15B] shrink-0" />
                <span>
                  {t(
                    'إدارة النسخ الاحتياطي واستعادة قاعدة البيانات متاحة للمدير العام (ADMIN) فقط.',
                    'La gestion des sauvegardes et restaurations est réservée à l’ADMIN.'
                  )}
                </span>
              </div>
            ) : (
              <>
                {/* Top Summary & Quick Create Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Last Backup Status Card */}
                  <div className="lg:col-span-2 p-5 bg-[#171717] rounded-2xl border border-[#33302B] space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 text-[#C6A15B] font-black">
                        <HardDrive className="w-5 h-5" />
                        <span className="text-base">
                          {t('حالة آخر نسخة احتياطية (SQLite)', 'Statut de la dernière sauvegarde (SQLite)')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={loadBackups}
                        className="px-3 py-1.5 rounded-xl bg-[#222222] border border-[#33302B] hover:border-[#C6A15B] text-xs font-bold text-[#A8A29E] flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin text-[#C6A15B]' : ''}`} />
                        <span>{t('تحديث القائمة', 'Actualiser')}</span>
                      </button>
                    </div>

                    {backupOverview?.lastVerifiedBackup ? (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="p-3 bg-[#222222] rounded-xl border border-[#33302B] space-y-1">
                          <div className="text-[#A8A29E]">{t('تاريخ آخر نسخة سليمة:', 'Dernière sauvegarde valide :')}</div>
                          <div className="font-mono font-black text-[#F7F3EA]" dir="ltr">
                            {new Date(backupOverview.lastVerifiedBackup.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="p-3 bg-[#222222] rounded-xl border border-[#33302B] space-y-1">
                          <div className="text-[#A8A29E]">{t('الحجم / النوع:', 'Taille / Type :')}</div>
                          <div className="font-mono font-black text-[#C6A15B]">
                            {formatBytes(backupOverview.lastVerifiedBackup.sizeBytes)} • {backupOverview.lastVerifiedBackup.type}
                          </div>
                        </div>
                        <div className="p-3 bg-[#222222] rounded-xl border border-[#33302B] space-y-1">
                          <div className="text-[#A8A29E]">{t('نتيجة الفحص:', 'Vérification :')}</div>
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-950/60 border border-emerald-600/50 text-emerald-300 font-black">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>
                              {backupOverview.lastVerifiedBackup.status} ({backupOverview.lastVerifiedBackup.integrityCheck})
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-600/40 text-amber-200 text-xs font-bold">
                        {t(
                          'لا توجد نسخة احتياطية مفحوصة بعد. يُنصح بإنشاء نسخة احتياطية فورية الآن.',
                          'Aucune sauvegarde vérifiée pour le moment. Créez une sauvegarde immédiatement.'
                        )}
                      </div>
                    )}

                    {backupOverview?.lastVerifiedBackup?.recordCounts && (
                      <div className="flex flex-wrap gap-2 text-[11px] font-mono text-[#A8A29E]">
                        <span className="px-2.5 py-1 rounded-lg bg-[#222222] border border-[#33302B]">
                          {t('الطلبات:', 'Commandes:')} <strong className="text-[#F7F3EA]">{backupOverview.lastVerifiedBackup.recordCounts.orders}</strong>
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-[#222222] border border-[#33302B]">
                          {t('المدفوعات:', 'Paiements:')} <strong className="text-[#F7F3EA]">{backupOverview.lastVerifiedBackup.recordCounts.payments}</strong>
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-[#222222] border border-[#33302B]">
                          {t('المخزون:', 'Ingrédients:')} <strong className="text-[#F7F3EA]">{backupOverview.lastVerifiedBackup.recordCounts.ingredients}</strong>
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-[#222222] border border-[#33302B]">
                          {t('المنتجات:', 'Produits:')} <strong className="text-[#F7F3EA]">{backupOverview.lastVerifiedBackup.recordCounts.products}</strong>
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-[#222222] border border-[#33302B]">
                          {t('الورديات:', 'Shifts:')} <strong className="text-[#F7F3EA]">{backupOverview.lastVerifiedBackup.recordCounts.cash_shifts}</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Manual Backup & Export Card */}
                  <div className="p-5 bg-[#171717] rounded-2xl border border-[#33302B] flex flex-col justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-[#C6A15B] font-black">
                        <Database className="w-5 h-5" />
                        <span>{t('النسخ الاحتياطي الفوري', 'Sauvegarde immédiate')}</span>
                      </div>
                      <p className="text-xs text-[#A8A29E] leading-relaxed">
                        {t(
                          'يستخدم SQLite Online Backup API لحفظ الطلبات، المدفوعات، المخزون والمستخدمين بأمان دون إيقاف النظام.',
                          'Utilise SQLite Online Backup API pour sauvegarder commandes, paiements et stocks sans interruption.'
                        )}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={isCreatingBackup}
                        onClick={handleCreateSqliteBackup}
                        className="w-full py-3 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-xl cursor-pointer"
                      >
                        <Database className="w-4 h-4" />
                        <span>
                          {isCreatingBackup
                            ? t('جاري إنشاء وفحص النسخة...', 'Sauvegarde en cours...')
                            : t('إنشاء نسخة احتياطية الآن', 'Créer une sauvegarde maintenant')}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDownloadBackup}
                        className="w-full py-2.5 bg-[#222222] hover:border-[#C6A15B] text-[#F7F3EA] font-bold text-xs rounded-xl border border-[#33302B] transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-[#C6A15B]" />
                        <span>{t('تصدير نسخة JSON إضافية', 'Exporter une copie JSON')}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Retention & Auto Backup Policy */}
                <div className="p-4 bg-[#171717] rounded-2xl border border-[#33302B] grid grid-cols-1 sm:grid-cols-4 gap-3 items-end text-xs">
                  <label className="flex items-center gap-2.5 bg-[#222222] border border-[#33302B] rounded-xl p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(settings['backup_auto_enabled'] ?? 'true') !== 'false'}
                      onChange={(e) => setSettings({ ...settings, backup_auto_enabled: String(e.target.checked) })}
                      className="accent-[#C6A15B] w-4 h-4"
                    />
                    <span className="font-bold">{t('نسخ يومي وأسبوعي تلقائي', 'Sauvegarde auto périodique')}</span>
                  </label>

                  <div>
                    <label className="block text-[#A8A29E] mb-1">
                      {t('الفاصل الدوري (ساعات):', 'Intervalle (heures) :')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="168"
                      value={settings['backup_interval_hours'] ?? String(backupOverview?.config?.intervalHours ?? 6)}
                      onChange={(e) => setSettings({ ...settings, backup_interval_hours: e.target.value })}
                      className="w-full bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[#A8A29E] mb-1">
                      {t('عدد النسخ المحتفظ بها:', 'Nombre de copies conservées :')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={settings['backup_retention_count'] ?? String(backupOverview?.config?.retentionCount ?? 14)}
                      onChange={(e) => setSettings({ ...settings, backup_retention_count: e.target.value })}
                      className="w-full bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-[#C6A15B] font-mono tabular-nums font-black"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isSavingSettings}
                    onClick={() => handleSaveSettings()}
                    className="py-2.5 px-4 bg-[#222222] hover:border-[#C6A15B] border border-[#33302B] text-[#C6A15B] font-black rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t('حفظ سياسة النسخ', 'Enregistrer la politique')}</span>
                  </button>
                </div>

                {/* Backups Archive Table */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A8A29E]">
                    <div className="flex items-center gap-2 font-black text-[#F7F3EA]">
                      <History className="w-4 h-4 text-[#C6A15B]" />
                      <span>{t('قائمة النسخ الاحتياطية المتوفرة', 'Historique des sauvegardes disponibles')}</span>
                    </div>
                    {backupOverview?.backupDirectory && (
                      <span className="font-mono text-[11px] opacity-80" dir="ltr">
                        {backupOverview.backupDirectory}
                      </span>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-[#33302B]">
                    <table className="w-full text-start text-xs sm:text-sm">
                      <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs">
                        <tr>
                          <th className="p-3">{t('اسم الملف', 'Fichier')}</th>
                          <th className="p-3">{t('النوع', 'Type')}</th>
                          <th className="p-3">{t('التاريخ والوقت', 'Date & heure')}</th>
                          <th className="p-3">{t('الحجم', 'Taille')}</th>
                          <th className="p-3">{t('السلامة', 'Intégrité')}</th>
                          <th className="p-3 text-center">{t('إجراءات', 'Actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#33302B] font-bold">
                        {!backupOverview || backupOverview.backups.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-[#A8A29E]">
                              {t('لا توجد نسخ احتياطية مسجلة حالياً.', 'Aucune sauvegarde disponible pour le moment.')}
                            </td>
                          </tr>
                        ) : (
                          backupOverview.backups.map((b) => {
                            const statusStyle =
                              b.status === 'VERIFIED'
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50'
                                : b.status === 'CORRUPTED' || b.status === 'FAILED'
                                  ? 'bg-rose-950/60 text-rose-300 border-rose-600/50'
                                  : 'bg-amber-950/60 text-amber-300 border-amber-600/50';
                            const isFailedNoFile = b.status === 'FAILED' && b.sizeBytes === 0;
                            return (
                              <tr key={b.filename} className="hover:bg-[#171717]/70 transition">
                                <td className="p-3">
                                  <div className="font-mono text-xs text-[#F7F3EA]" dir="ltr">
                                    {b.filename}
                                  </div>
                                  {b.error && <div className="text-[11px] text-rose-300 mt-0.5">{b.error}</div>}
                                </td>
                                <td className="p-3">
                                  <span className="px-2 py-0.5 rounded-lg bg-[#171717] border border-[#33302B] text-[#C6A15B] font-mono text-xs">
                                    {b.type}
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-xs text-[#A8A29E]" dir="ltr">
                                  {new Date(b.createdAt).toLocaleString()}
                                </td>
                                <td className="p-3 font-mono text-xs text-[#F7F3EA]">{formatBytes(b.sizeBytes)}</td>
                                <td className="p-3">
                                  <span className={`px-2.5 py-0.5 rounded-lg border text-xs font-black ${statusStyle}`}>
                                    {b.status}
                                  </span>
                                </td>
                                <td className="p-3">
                                  {!isFailedNoFile && (
                                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                      <button
                                        type="button"
                                        disabled={verifyingFilename === b.filename}
                                        onClick={() => handleVerifySqliteBackup(b.filename)}
                                        className="px-2.5 py-1.5 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-xs font-black text-[#F7F3EA] cursor-pointer"
                                      >
                                        {verifyingFilename === b.filename
                                          ? t('فحص...', 'Vérif...')
                                          : t('فحص', 'Vérifier')}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={downloadingFilename === b.filename}
                                        onClick={() => handleDownloadSqliteBackup(b.filename)}
                                        className="px-2.5 py-1.5 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-xs font-black text-[#C6A15B] cursor-pointer"
                                      >
                                        {downloadingFilename === b.filename
                                          ? t('تحميل...', 'Téléch...')
                                          : t('تحميل', 'Télécharger')}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openRestoreWarning(b)}
                                        className="px-2.5 py-1.5 rounded-xl bg-amber-950/40 border border-amber-600/50 hover:bg-amber-900/60 text-xs font-black text-amber-200 cursor-pointer"
                                      >
                                        {t('استعادة', 'Restaurer')}
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Desktop Storage & Pre-Update Safe Guard Card (Task 06, 07, 08) */}
                {desktopStatus && (
                  <div className="p-4 bg-[#171717] rounded-2xl border border-[#33302B] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[#C6A15B] font-black">
                        <ShieldCheck className="w-5 h-5" />
                        <span>
                          {t(
                            'مسارات بيانات سطح المكتب وفحص التحديث الآمن',
                            'Stockage Desktop & Contrôle de mise à jour sécurisée'
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={isCheckingPreUpdate}
                        onClick={handlePreUpdateCheck}
                        className="px-3.5 py-2 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-xs cursor-pointer"
                      >
                        {isCheckingPreUpdate
                          ? t('جاري الفحص...', 'Vérification...')
                          : t('فحص جاهزية التحديث والنسخ الوقائي', 'Préparer mise à jour sécurisée')}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      <div className="p-2.5 bg-[#222222] rounded-xl border border-[#33302B]">
                        <div className="text-[#A8A29E] mb-0.5">{t('مسار قاعدة البيانات:', 'Base SQLite :')}</div>
                        <div className="font-mono text-[11px] text-[#F7F3EA] break-all" dir="ltr">
                          {desktopStatus.dbPath}
                        </div>
                        <div className="text-[11px] text-emerald-400 mt-1">
                          {desktopStatus.dbWritable ? 'Writable ✓' : 'Read-only ✗'} • Integrity: {desktopStatus.integrityCheck}
                        </div>
                      </div>
                      <div className="p-2.5 bg-[#222222] rounded-xl border border-[#33302B]">
                        <div className="text-[#A8A29E] mb-0.5">{t('مجلد النسخ الاحتياطي:', 'Dossier Sauvegardes :')}</div>
                        <div className="font-mono text-[11px] text-[#F7F3EA] break-all" dir="ltr">
                          {desktopStatus.backupDir}
                        </div>
                        <div className="text-[11px] text-emerald-400 mt-1">
                          {desktopStatus.backupDirWritable ? 'Writable ✓' : 'Read-only ✗'} • {desktopStatus.tablesCount} tables
                        </div>
                      </div>
                    </div>

                    {!desktopStatus.pendingFinancialOps.canUpdateSafely && (
                      <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-600/50 text-amber-200 text-xs space-y-1">
                        <div className="font-black">
                          {t('عمليات مفتوحة تمنع التحديث الآن:', 'Opérations en cours bloquant la mise à jour :')}
                        </div>
                        {desktopStatus.pendingFinancialOps.blockingReasons.map((r, idx) => (
                          <div key={idx}>• {r}</div>
                        ))}
                      </div>
                    )}

                    {preUpdateResult?.allowed && (
                      <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-600/50 text-emerald-200 text-xs font-bold">
                        {t(
                          `النظام جاهز للتحديث بأمان. تم حفظ نسخة ما قبل التحديث: ${preUpdateResult.preUpdateBackup?.filename || ''}`,
                          `Prêt pour mise à jour sécurisée. Sauvegarde : ${preUpdateResult.preUpdateBackup?.filename || ''}`
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Add Staff Modal */}
      {showAddStaffModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">{t('إضافة موظف جديد', 'Nouvel employé')}</h3>
              <button
                type="button"
                onClick={() => setShowAddStaffModal(false)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {staffModalError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-600/60 text-rose-200 text-xs font-bold">
                {staffModalError}
              </div>
            )}

            <div className="space-y-3 font-bold text-sm">
              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم الكامل *', 'Nom complet *')}</label>
                <input
                  type="text"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('اسم المستخدم *', 'Identifiant *')}</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('الهاتف', 'Téléphone')}</label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('البريد الإلكتروني', 'Email')}</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@goldenpalace.dz"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('كلمة المرور *', 'Mot de passe *')}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('رمز PIN (4-12)', 'Code PIN (4-12)')}</label>
                  <input
                    type="password"
                    maxLength={12}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder="••••"
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#C6A15B] font-mono text-center"
                  />
                </div>

                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('الدور', 'Rôle')}</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as Role)}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black"
                  >
                    <option value="CASHIER">{roleLabel('CASHIER')}</option>
                    <option value="WAITER">{roleLabel('WAITER')}</option>
                    <option value="KITCHEN">{roleLabel('KITCHEN')}</option>
                    <option value="MANAGER">{roleLabel('MANAGER')}</option>
                    <option value="INVENTORY">{roleLabel('INVENTORY')}</option>
                    <option value="ADMIN">{roleLabel('ADMIN')}</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={isSavingStaff}
              onClick={handleCreateStaff}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-xl cursor-pointer"
            >
              {isSavingStaff ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ الموظف', 'Créer l’employé')}
            </button>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">
                {t('تعديل بيانات الموظف:', 'Modifier employé :')} {editingUser.username}
              </h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {staffModalError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-600/60 text-rose-200 text-xs font-bold">
                {staffModalError}
              </div>
            )}

            <div className="space-y-3 text-sm font-bold">
              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم الكامل *', 'Nom complet *')}</label>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('البريد الإلكتروني *', 'Email *')}</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الهاتف', 'Téléphone')}</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الدور', 'Rôle')}</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as Role)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black"
                >
                  <option value="CASHIER">{roleLabel('CASHIER')}</option>
                  <option value="WAITER">{roleLabel('WAITER')}</option>
                  <option value="KITCHEN">{roleLabel('KITCHEN')}</option>
                  <option value="MANAGER">{roleLabel('MANAGER')}</option>
                  <option value="INVENTORY">{roleLabel('INVENTORY')}</option>
                  <option value="ADMIN">{roleLabel('ADMIN')}</option>
                </select>
              </div>

              <label className="flex items-center gap-2.5 bg-[#171717] border border-[#33302B] rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="accent-[#C6A15B] w-4 h-4"
                />
                <span className="text-xs font-bold">{t('الحساب نشط ويسمح بتسجيل الدخول', 'Compte actif')}</span>
              </label>
            </div>

            <button
              type="button"
              disabled={isSavingStaff}
              onClick={handleUpdateStaff}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-xl cursor-pointer"
            >
              {isSavingStaff ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ التغييرات', 'Enregistrer')}
            </button>
          </div>
        </div>
      )}

      {/* Secure PIN Reset Modal */}
      {pinResetUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B] flex items-center gap-2">
                <Key className="w-5 h-5" />
                <span>{t('تعيين رمز PIN جديد', 'Nouveau code PIN')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setPinResetUser(null)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#A8A29E]">
              {t(`الموظف: ${pinResetUser.fullName}. سيتم تشفير الرمز فوراً عبر bcrypt.`, `Employé : ${pinResetUser.fullName}. Le PIN sera immédiatement haché.`)}
            </p>

            {staffModalError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-600/60 text-rose-200 text-xs font-bold">
                {staffModalError}
              </div>
            )}

            <div>
              <label className="block text-[#A8A29E] text-xs mb-1">{t('رمز PIN الجديد (4-12 خانة)', 'Nouveau PIN (4-12 caractères)')}</label>
              <input
                type="password"
                maxLength={12}
                value={pinResetValue}
                onChange={(e) => setPinResetValue(e.target.value)}
                placeholder="••••"
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#C6A15B] font-mono text-center text-xl tracking-widest focus:outline-none focus:border-[#C6A15B]"
              />
            </div>

            <button
              type="button"
              disabled={isSavingStaff}
              onClick={handleResetPin}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-xl cursor-pointer"
            >
              {isSavingStaff ? t('جاري التشفير والحفظ...', 'Chiffrement...') : t('حفظ رمز PIN', 'Enregistrer le PIN')}
            </button>
          </div>
        </div>
      )}

      {/* Restore Step 1: Clear Warning Modal */}
      {restoreStep === 1 && restoreTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-amber-500/60 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <span>{t('تحذير: استعادة قاعدة البيانات', 'Avertissement : Restauration de la base')}</span>
              </h3>
              <button
                type="button"
                onClick={closeRestoreModals}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-600/40 text-xs text-amber-100 space-y-2 leading-relaxed">
              <p className="font-black">
                {t(
                  'ستؤدي هذه العملية إلى استبدال قاعدة البيانات الحالية بالكامل بمحتوى النسخة المختارة.',
                  'Cette opération remplacera entièrement la base de données actuelle par la sauvegarde sélectionnée.'
                )}
              </p>
              <p>
                {t(
                  'لحماية بياناتك، سيقوم النظام أولاً بفحص النسخة المختارة وإنشاء نسخة أمان تلقائية لقاعدة البيانات الحالية قبل التطبيق.',
                  'Par sécurité, le système vérifiera d’abord l’intégrité de la sauvegarde et créera une copie pré-restauration automatique.'
                )}
              </p>
            </div>

            <div className="p-3 bg-[#171717] rounded-xl border border-[#33302B] text-xs space-y-1">
              <div className="text-[#A8A29E]">{t('النسخة المختارة:', 'Sauvegarde sélectionnée :')}</div>
              <div className="font-mono font-black text-[#C6A15B]" dir="ltr">
                {restoreTarget.filename}
              </div>
              <div className="text-[#A8A29E]">
                {formatBytes(restoreTarget.sizeBytes)} • {new Date(restoreTarget.createdAt).toLocaleString()}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRestoreStep(2)}
                className="flex-1 py-3 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-xs sm:text-sm rounded-xl cursor-pointer"
              >
                {t('متابعة إلى التأكيد النهائي', 'Continuer vers la confirmation')}
              </button>
              <button
                type="button"
                onClick={closeRestoreModals}
                className="px-4 py-3 bg-[#171717] border border-[#33302B] text-[#F7F3EA] font-bold text-xs sm:text-sm rounded-xl cursor-pointer"
              >
                {t('إلغاء', 'Annuler')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Step 2: Explicit Second Confirmation Modal */}
      {restoreStep === 2 && restoreTarget && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-rose-500/60 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-rose-300 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-rose-400" />
                <span>{t('التأكيد النهائي للاستعادة', 'Confirmation finale de restauration')}</span>
              </h3>
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={closeRestoreModals}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#A8A29E] leading-relaxed">
              {t(
                `هل أنت متأكد تماماً من رغبتك في استعادة قاعدة البيانات من الملف ${restoreTarget.filename}؟`,
                `Confirmez-vous la restauration de la base de données à partir du fichier ${restoreTarget.filename} ?`
              )}
            </p>

            {restoreError && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-600/60 text-rose-200 text-xs font-bold">
                {restoreError}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={handleConfirmRestore}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-xs sm:text-sm rounded-xl cursor-pointer"
              >
                {isRestoringBackup
                  ? t('جاري التحقق والاستعادة...', 'Vérification et restauration...')
                  : t('تأكيد الاستعادة الآن', 'Confirmer la restauration maintenant')}
              </button>
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={closeRestoreModals}
                className="px-4 py-3 bg-[#171717] border border-[#33302B] text-[#F7F3EA] font-bold text-xs sm:text-sm rounded-xl cursor-pointer"
              >
                {t('إلغاء', 'Annuler')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
