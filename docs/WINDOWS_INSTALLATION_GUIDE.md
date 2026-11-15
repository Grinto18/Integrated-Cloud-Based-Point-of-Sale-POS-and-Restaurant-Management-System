# GOLDEN PALACE POS — Windows 10 / 11 Installation Guide

## 1. System Requirements
- **Operating System:** Windows 10 (64-bit) or Windows 11 (64-bit).
- **Hardware:** 4 GB RAM minimum (8 GB recommended), 500 MB free disk space for app + local SQLite backups.
- **Peripherals:** 58mm or 80mm thermal receipt printer (Windows Spooler USB driver, Ethernet LAN TCP Port 9100, or USB Web Serial).

---

## 2. Building the Windows Installer (On a Windows x64 Machine)
> If building from source on Windows:
1. Install Node.js 20+ LTS (x64) and Visual Studio Build Tools (`Desktop development with C++`) for `better-sqlite3` native ABI compilation.
2. Open PowerShell or Command Prompt in the project root directory and run:
   ```cmd
   npm install
   npm run rebuild:electron
   npm run pack:win
   ```
3. The NSIS installer will be generated at:
   `release\GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe`

---

## 3. Installing GOLDEN PALACE POS on the Restaurant Terminal
1. Double-click `GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe`.
2. Choose the installation directory (default per-user AppData Programs path) and confirm **Create Desktop Shortcut** and **Create Start Menu Shortcut**.
3. Launch **GOLDEN PALACE POS** from the Desktop or Start Menu shortcut.
4. Confirm single-instance protection works (launching a second time focuses the existing window rather than starting a second backend server).

---

## 4. Verifying Storage, Database, and Backup Paths
After launching the app and signing in as `ADMIN`:
1. Open **الإعدادات (Settings) → النسخ الاحتياطي (Backup)**.
2. Verify the displayed desktop storage paths:
   - **SQLite Database Path:**
     `C:\Users\<WindowsUser>\AppData\Roaming\Golden Palace POS\golden_palace_production.db`
   - **Backup Directory (Independent from Database & App Install Folder):**
     `C:\Users\<WindowsUser>\AppData\Roaming\Golden Palace POS\backups_production\`
   - **Database Status:** `PRAGMA integrity_check = ok`, Writable = `Yes`.
3. Confirm **no `.db` or `backups_production\` files** exist inside the installation program folder.

---

## 5. Creating the First Administrator Account
1. On a **fresh installation** (zero users in SQLite), GOLDEN PALACE POS automatically displays the **First-Run Administrator Setup** screen (no hardcoded default `1234` PIN is created).
2. Enter the owner's Full Name, Username, Email (optional), strong Password (8+ characters), and personal non-trivial PIN (4–12 digits, e.g., not `1234` or repeated digits).
3. Submit to initialize the primary `ADMIN` account and unlock the POS.
4. For subsequent staff (`CASHIER`, `MANAGER`, `WAITER`, `KITCHEN`, `INVENTORY`), create accounts inside **Settings → Staff & RBAC**.

---

## 6. Configuring the Thermal Printer
1. Open **Settings → الطابعة (Printer)**.
2. Click **اكتشاف الطابعات (Detect Printers)** to list installed Windows printers, or choose **NETWORK_IP** (Port `9100`) / **USB (Web Serial)** / **Browser / Electron**.
3. Select roll width (`80mm` / `70mm` recommended printable width, or `58mm` / `48mm`) and Arabic ESC/POS encoding (`CP864` recommended for Epson/Xprinter, or `Windows-1256` / `UTF-8`).
4. Click **حفظ في قاعدة البيانات (Save to Database)**.
5. Run **اختبار الطباعة**, **اختبار العربية (AR/FR)**, and **اختبار صفحة فارغة / قطع الورق** and visually verify physical paper output.

---

## 7. Creating the First Verified Backup
1. Open **Settings → النسخ الاحتياطي (Backup)**.
2. Click **إنشاء نسخة احتياطية الآن (Create Backup Now)**.
3. Verify the newly created `.db` file shows **VERIFIED (`integrity_check: ok`)** and record counts match live orders/menu/users.

---

## 8. Safe Upgrades & Uninstallation
- Before installing a newer version: close any open cash shift, resolve any pending offline sync items/conflicts, and click **فحص ما قبل التحديث (Pre-Update Check)** inside Settings → Backups to generate a pre-update verified backup + recovery manifest.
- Uninstalling or upgrading **does not delete** `%APPDATA%\Golden Palace POS\golden_palace_production.db`, `.jwt_secret`, or `backups_production\` (`deleteAppDataOnUninstall: false`).
