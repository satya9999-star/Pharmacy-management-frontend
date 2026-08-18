import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Analytics,
  ActivityLogEntry,
  Batch,
  Credit,
  Customer,
  Dashboard,
  Distributor,
  DistributorBillView,
  DistributorPaymentView,
  DistributorPriceComparison,
  MasterMedicineView,
  Medicine,
  PaymentMode,
  PharmacyApi,
  Role,
  Sale,
  UserView,
  AiPharmacistResponse
} from './pharmacy.api';

// View types
type View = 'dashboard' | 'stock-watch' | 'credit-watch' | 'inventory' | 'inventory-form' | 'expiry' | 'billing' | 'credits'
  | 'distributors' | 'distributor-form' | 'distributor-ledger' | 'distributor-invoice' | 'medicine-detail'
  | 'profits-losses' | 'bulk-upload' | 'sales-history' | 'store-config'
  | 'distributor-comparison' | 'activity-log' | 'customer-form' | 'users' | 'user-form' | 'sales-analytics' | 'ai-pharmacist' | 'csv-master' | 'know-your-medicine';
type ExpiryScope = 'near' | 'expired';
type ExpirySort = 'expiry-asc' | 'expiry-desc' | 'medicine' | 'quantity';
type ExpiryState = 'valid' | 'near' | 'expired';

export interface GroupedCustomerCredit {
  customerId: number;
  customerName: string;
  totalCreditAmount: number;
  totalPaidAmount: number;
  totalDueAmount: number;
  billsCount: number;
  earliestDueDate?: string;
  latestDueDate?: string;
  bills: Credit[];
  isExpanded?: boolean;
}

interface InventoryRow {
  medicine: Medicine;
  batch: Medicine['batches'][number];
  daysUntilExpiry: number;
  expiryState: ExpiryState;
}

interface Slice {
  label: string;
  value: number;
  color: string;
  percentage: number;
  pathData: string;
  isFullCircle?: boolean;
}

function getLocalIsoDate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMedicineSearchRelevanceScore(item: any, query: string): number {
  if (!item || !query) return 0;
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const name = (item.name || '').trim().toLowerCase();
  const genericName = (item.genericName || item.saltComposition || '').trim().toLowerCase();
  const code = (item.code || '').trim().toLowerCase();
  const manufacturer = (item.manufacturer || item.manufacturerName || '').trim().toLowerCase();

  const terms: string[] = q.split(/[\s,]+/).filter((t: string) => t.length > 0);
  if (terms.length === 0) return 0;
  const firstTerm = terms[0];

  // 1. Exact full name match
  if (name === q) return 10000;

  // 2. Name starts with full query
  if (name.startsWith(q)) return 9000;

  // 3. Name starts with first term (e.g. "zifi" matches "Zifi 200 Tablet")
  if (name.startsWith(firstTerm)) return 8000;

  // 4. Any word in Name starts with first term (word boundary match)
  const nameWords = name.split(/[\s\-_]+/);
  if (nameWords.length > 0 && nameWords[0].startsWith(firstTerm)) return 7000;
  for (const w of nameWords) {
    if (w.startsWith(firstTerm)) return 6000;
  }

  // 5. Code exact or starts with query
  if (code === q) return 5500;
  if (code.startsWith(q)) return 5000;

  // 6. Generic name / Composition starts with query or word in generic name starts with query
  if (genericName.startsWith(q)) return 4500;
  const genericWords = genericName.split(/[\s\-_+]+/);
  for (const w of genericWords) {
    if (w.startsWith(firstTerm)) return 4000;
  }

  // 7. Full name contains full query as substring
  if (name.includes(q)) return 3000;

  // 8. Name contains all terms anywhere
  if (terms.every((t: string) => name.includes(t))) return 2000;

  // 9. Generic name or manufacturer contains full query or terms
  if (genericName.includes(q) || manufacturer.includes(q)) return 1000;

  return 100;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnDestroy {
  private readonly api = inject(PharmacyApi);
  readonly paymentModes: PaymentMode[] = ['CASH', 'UPI', 'CARD', 'CREDIT'];
  readonly Math = Math;
  readonly today = getLocalIsoDate();
  readonly nearExpiryDays = 90;
  storeBill = {
    name: localStorage.getItem('store-name') ?? 'Sri Lakshmi Medical And Fancy Stores',
    addressLine1: localStorage.getItem('store-address1') ?? 'D. No. 1-176, Beside Gandhi statue,',
    addressLine2: localStorage.getItem('store-address2') ?? 'Main Road Makkapeta, Makkapeta-521190',
    phone: localStorage.getItem('store-phone') ?? '9989207847',
    drugLicense22: localStorage.getItem('store-dl22') ?? 'TS/RR/2022-71557',
    drugLicense21: localStorage.getItem('store-dl21') ?? 'TS/RR/2023-71557',
    gstNumber: localStorage.getItem('store-gst') ?? '36AGYPV269P1ZU',
    enableAutoReminders: localStorage.getItem('store-enable-auto-reminders') !== 'false',
    reminderDays: Number(localStorage.getItem('store-reminder-days') ?? '3'),
    whatsappGatewayUrl: '',
    whatsappToken: '',
    whatsappSender: '',
    dailyReminderTime: '09:00'
  };

  editingCustomerId?: number;
  editingStoreSettings = false;
  editingWhatsAppConfig = false;
  editingReminderConfig = false;
  selectedCreditIds = new Set<number>();
  confirmingCreditId: number | null = null;

  knowMedicineQuery: string = '';
  knowMedicineResults: MasterMedicineView[] = [];
  knowMedicineSelected: MasterMedicineView | null = null;
  knowMedicineSearching: boolean = false;

  editingUserId?: number;
  usersList: UserView[] = [];
  userForm = {
    username: '',
    password: '',
    fullName: '',
    mobile: '',
    email: '',
    role: 'STAFF' as Role,
    active: true,
    otp: ''
  };
  originalEditingMobile = '';
  updateMobileOtpSent = false;
  resetPasswordForm = {
    password: ''
  };
  showResetPasswordModal = false;
  resetPasswordTargetUser?: UserView;

  showDeleteUserModal = false;
  deleteTargetUser?: UserView;
  deleteOtpSent = false;
  deleteOtpCode = '';
  deleteErrorMessage = '';

  showForgotPasswordForm = false;
  forgotPasswordForm = {
    username: '',
    mobile: ''
  };
  forgotPasswordMessage = '';
  forgotPasswordSuccess = '';

  showForcePasswordChangeModal = false;
  forcePasswordChangeForm = {
    username: '',
    temporaryPassword: '',
    newPassword: '',
    confirmNewPassword: ''
  };
  forcePasswordChangeMessage = '';

  showRegisterForm = false;
  registerStep = 1;
  registerForm = {
    username: '',
    password: '',
    fullName: '',
    mobile: '',
    email: '',
    otp: ''
  };
  registerMessage = '';
  registerSuccess = '';

  view: View = 'dashboard';
  login = { username: '', password: '' };
  user = '';
  role = '';
  dashboard?: Dashboard;
  financialSlices: Slice[] = [];
  financialTotal = 0;
  expenditureSlices: Slice[] = [];
  expenditureTotal = 0;
  ledgerDatePreset = '';
  ledgerStartDate = '';
  ledgerEndDate = '';
  ledgerStatusFilter = '';
  plStartDate = '';
  plEndDate = '';
  plDatePreset = '';
  cwStartDate = '';
  cwEndDate = '';
  cwDatePreset = '';
  distributorBillsHistory: DistributorBillView[] = [];
  medicines: Medicine[] = [];
  distributors: Distributor[] = [];
  customers: Customer[] = [];
  credits: Credit[] = [];
  salesHistory: Sale[] = [];
  lastSale?: Sale;
  busy = false;
  message = '';
  private _inventorySearch = '';
  get inventorySearch(): string {
    return this._inventorySearch;
  }
  set inventorySearch(value: string) {
    this._inventorySearch = value;
    this.inventoryPageIndex = 0;
  }
  inventoryPageIndex = 0;
  inventoryPageSize = 10;
  expirySearch = '';
  customerSearchQuery = '';
  selectedReportCustomer?: Customer;
  customerCreditHistory: Credit[] = [];
  viewingInvoice?: Sale;
  returnView?: View;
  viewHistory: View[] = [];
  expiryScope: ExpiryScope = 'near';
  expirySort: ExpirySort = 'expiry-asc';
  editingMedicineId?: number;
  editingDistributorId?: number;
  editingBatchId?: number;
  originalMedicineObj: Medicine | null = null;
  originalBatchObj: Batch | null = null;

  // Analytics
  analyticsData?: Analytics;
  analyticsChartPeriod: number = 30;
  analyticsDatePreset = 'month';
  analyticsStartDate = '';
  analyticsEndDate = '';
  selectedSalesPoint?: any;
  currentTime: string = '';
  private timerId?: any;

  // Custom Confirmation Dialog Overlay
  showConfirmModal = false;
  confirmTitle = 'Confirm Action';
  confirmMessage = '';
  confirmCallback: (() => void) | null = null;
  cancelCallback: (() => void) | null = null;

  showConfirm(message: string, onConfirm: () => void, title = 'Confirm Action', onCancel?: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.confirmCallback = onConfirm;
    this.cancelCallback = onCancel || null;
    this.showConfirmModal = true;
  }

  triggerConfirm(): void {
    const callback = this.confirmCallback;
    this.closeConfirm();
    if (callback) {
      callback();
    }
  }

  triggerCancel(): void {
    const callback = this.cancelCallback;
    this.closeConfirm();
    if (callback) {
      callback();
    }
  }

  closeConfirm(): void {
    this.showConfirmModal = false;
    this.confirmCallback = null;
    this.cancelCallback = null;
  }

  showInternalAuditModal = false;

  // AI Pharmacist Search State
  aiSearchQuery = '';
  aiSearching = false;
  aiSearchResult: AiPharmacistResponse | null = null;
  aiSearchError = '';

  get greeting(): string {
    const hr = new Date().getHours();
    if (hr >= 5 && hr < 12) return 'Good morning';
    if (hr >= 12 && hr < 17) return 'Good afternoon';
    return 'Good evening';
  }

  get userShortName(): string {
    if (!this.user) return '';
    return this.user.split(' ')[0];
  }

  updateTime(): void {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }

  // Distributor Comparison
  distributorComparisonData: DistributorPriceComparison[] = [];
  comparisonSearchQuery = '';

  // Activity Log
  activityLogData: ActivityLogEntry[] = [];

  // Barcode
  barcodeScanInput = '';
  showBarcodeModal = false;
  barcodeMedicine: any = null;

  selectedPaymentBill?: DistributorBillView;
  upiPaymentAmount = 0;
  upiPaymentReference = '';
  showUpiPaymentModal = false;

  selectedInventoryRow?: InventoryRow;
  alternateGenericSearch = '';
  excludeMedicineId?: number;

  uploadedItems: any[] = [];
  bulkBillForm = {
    distributorId: 0,
    billNo: '',
    billDate: '',
    dueDate: ''
  };

  medicineForm = {
    code: '',
    name: '',
    genericName: '',
    manufacturer: '',
    category: '',
    hsnCode: '',
    gstPercentage: 0,
    mrp: 0,
    sellingPrice: 0,
    discount: 0,
    prescriptionRequired: false,
    stockWatchQty: 0,
    sideEffects: ''
  };
  batchForm = {
    medicineId: 0,
    batchNo: '',
    expiryDate: '',
    purchasePrice: 0,
    sellingPrice: 0,
    quantity: 0,
    availableQuantity: 0,
    distributorId: 0,
    billNo: '',
    billDate: '',
    dueDate: '',
    gstPercentage: 0,
    mrp: 0,
    discount: 0
  };
  selectedDistributor?: Distributor;
  distributorBillsList: DistributorBillView[] = [];
  distributorPaymentsList: DistributorPaymentView[] = [];
  selectedDistributorBill?: DistributorBillView;
  ledgerTab: 'credit' | 'debit' = 'credit';
  distributorPaymentForm = {
    billId: 0,
    amount: 0,
    paymentMode: 'UPI',
    referenceNo: ''
  };
  customerCreditPaymentForm = {
    customerId: 0,
    creditId: 0,
    amount: 0,
    paymentMode: 'CASH',
    referenceNo: ''
  };
  distributorForm = {
    name: '',
    contactPerson: '',
    mobile: '',
    email: '',
    gstNumber: '',
    address: '',
    upiId: '',
    bankName: '',
    bankAccountNo: '',
    bankIfscCode: ''
  };
  customerForm = {
    name: '',
    mobile: '',
    address: '',
    creditLimit: 0
  };
  saleForm = {
    customerId: 0,
    customerAge: '',
    doctorName: '',
    paymentMode: 'CASH' as PaymentMode,
    discountAmount: 0,
    creditDueDate: '',
    items: [{ medicineId: 0, quantity: 1 }]
  };
  paymentAmounts: Record<number, number> = {};
  creditPaymentModes: Record<number, string> = {};
  creditPaymentReferences: Record<number, string> = {};

  expandedTxnId: number | null = null;


  customerType: 'regular' | 'credit-existing' | 'credit-new' = 'regular';
  creditCustomerSearchQuery = '';
  creditSearchFocused = false;
  selectedCreditCustomer?: Customer;
  upfrontPaymentAmount = 0;
  upfrontPaymentMode: PaymentMode = 'CASH';
  regularCustomerName = 'Walk-in';
  regularCustomerMobile = '';

  // Stock Watch Order variables
  swAddMode: 'search' | 'new' = 'search';
  swSearchQuery = '';
  swSearchFocused = false;
  swMessage = '';
  manuallyAddedToStockWatch: number[] = [];
  swOrderForm = { medicineId: null as number | null, orderedQuantity: 30 };
  swNewForm = { name: '', genericName: '', manufacturer: '', orderedQuantity: 30 };

  constructor() {
    sessionStorage.clear();
    localStorage.clear();
    this.user = '';
    this.role = '';
    this.loadDefaultCompositionCsv();
    this.initAnalyticsPreset();
    this.updateTime();
    this.timerId = setInterval(() => this.updateTime(), 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  loadStoreConfig(): void {
    this.api.getStoreConfig().subscribe({
      next: config => {
        if (config) {
          this.storeBill = {
            name: config.name || '',
            addressLine1: config.addressLine1 || '',
            addressLine2: config.addressLine2 || '',
            phone: config.phone || '',
            drugLicense22: config.drugLicense22 || '',
            drugLicense21: config.drugLicense21 || '',
            gstNumber: config.gstNumber || '',
            enableAutoReminders: config.enableAutoReminders,
            reminderDays: config.reminderDays,
            whatsappGatewayUrl: config.whatsappGatewayUrl || '',
            whatsappToken: config.whatsappToken || '',
            whatsappSender: config.whatsappSender || '',
            dailyReminderTime: config.dailyReminderTime || '09:00'
          };
          localStorage.setItem('store-name', this.storeBill.name);
          localStorage.setItem('store-address1', this.storeBill.addressLine1);
          localStorage.setItem('store-address2', this.storeBill.addressLine2);
          localStorage.setItem('store-phone', this.storeBill.phone);
          localStorage.setItem('store-dl22', this.storeBill.drugLicense22);
          localStorage.setItem('store-dl21', this.storeBill.drugLicense21);
          localStorage.setItem('store-gst', this.storeBill.gstNumber);
          localStorage.setItem('store-enable-auto-reminders', String(this.storeBill.enableAutoReminders));
          localStorage.setItem('store-reminder-days', String(this.storeBill.reminderDays));
          localStorage.setItem('store-reminder-time', this.storeBill.dailyReminderTime);
        }
      },
      error: () => { }
    });
  }

  signIn(): void {
    this.busy = true;
    this.api.login(this.login.username, this.login.password).subscribe({
      next: result => {
        if (result.passwordResetRequired) {
          this.showForcePasswordChangeModal = true;
          this.forcePasswordChangeForm = {
            username: this.login.username.trim(),
            temporaryPassword: this.login.password.trim(),
            newPassword: '',
            confirmNewPassword: ''
          };
          this.forcePasswordChangeMessage = '';
          this.busy = false;
          return;
        }
        sessionStorage.setItem('pharmacy-token', result.token);
        sessionStorage.setItem('pharmacy-user', result.fullName);
        sessionStorage.setItem('pharmacy-role', result.role);
        this.user = result.fullName;
        this.role = result.role;
        this.message = '';
        this.reload();
        this.loadStoreConfig();
      },
      error: error => this.fail(error),
      complete: () => this.busy = false
    });
  }

  submitForcePasswordChange(): void {
    const f = this.forcePasswordChangeForm;
    if (!f.temporaryPassword.trim() || !f.newPassword.trim() || !f.confirmNewPassword.trim()) {
      this.forcePasswordChangeMessage = 'Error: All fields are required.';
      return;
    }
    if (f.newPassword !== f.confirmNewPassword) {
      this.forcePasswordChangeMessage = 'Error: Password and Confirm Password do not match.';
      return;
    }
    const strength = this.checkPasswordStrength(f.newPassword);
    if (!strength.valid) {
      this.forcePasswordChangeMessage = 'Error: Password does not meet security complexity requirements.';
      return;
    }
    if (f.newPassword === f.temporaryPassword) {
      this.forcePasswordChangeMessage = 'Error: New password cannot be same as temporary password.';
      return;
    }

    this.busy = true;
    this.forcePasswordChangeMessage = '';
    this.api.forceChangePassword({
      username: f.username.trim(),
      temporaryPassword: f.temporaryPassword.trim(),
      newPassword: f.newPassword.trim()
    }).subscribe({
      next: result => {
        sessionStorage.setItem('pharmacy-token', result.token);
        sessionStorage.setItem('pharmacy-user', result.fullName);
        sessionStorage.setItem('pharmacy-role', result.role);
        this.user = result.fullName;
        this.role = result.role;
        this.showForcePasswordChangeModal = false;
        this.message = 'Password successfully updated!';
        this.reload();
        this.loadStoreConfig();
      },
      error: error => {
        this.busy = false;
        this.forcePasswordChangeMessage = error.error?.message ?? 'Error: Password change failed.';
      },
      complete: () => this.busy = false
    });
  }

  toggleForgotPasswordView(show: boolean): void {
    this.showForgotPasswordForm = show;
    this.showRegisterForm = false;
    this.message = '';
    this.forgotPasswordMessage = '';
    this.forgotPasswordSuccess = '';
    this.forgotPasswordForm = { username: '', mobile: '' };
  }

  sendForgotPasswordReset(): void {
    const f = this.forgotPasswordForm;
    if (!f.username.trim() || !f.mobile.trim()) {
      this.forgotPasswordMessage = 'Error: Username and mobile number are required.';
      return;
    }
    if (!/^\d{10}$/.test(f.mobile.trim())) {
      this.forgotPasswordMessage = 'Error: Mobile number must be exactly 10 digits (numeric only).';
      return;
    }

    this.busy = true;
    this.forgotPasswordMessage = '';
    this.forgotPasswordSuccess = '';
    this.api.forgotPassword({
      username: f.username.trim(),
      mobile: f.mobile.trim()
    }).subscribe({
      next: () => {
        this.forgotPasswordSuccess = 'Temporary password has been sent to your WhatsApp!';
      },
      error: error => {
        this.busy = false;
        this.forgotPasswordMessage = error.error?.message ?? 'Error: Password reset failed.';
      },
      complete: () => this.busy = false
    });
  }

  checkPasswordStrength(pwd: string) {
    const p = pwd || '';
    const length = p.length >= 8;
    const upper = /[A-Z]/.test(p);
    const lower = /[a-z]/.test(p);
    const digit = /[0-9]/.test(p);
    const special = /[@$!%*?&]/.test(p);
    return {
      length,
      upper,
      lower,
      digit,
      special,
      valid: length && upper && lower && digit && special
    };
  }

  logout(): void {
    sessionStorage.clear();
    this.user = '';
    this.role = '';
    this.dashboard = undefined;
    this.medicines = [];
    this.message = '';
    this.view = 'dashboard';
  }

  polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  }

  describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number): string {
    const start = this.polarToCartesian(x, y, radius, startAngle);
    const end = this.polarToCartesian(x, y, radius, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
      'M', x, y,
      'L', start.x, start.y,
      'A', radius, radius, 0, largeArcFlag, 1, end.x, end.y,
      'Z'
    ].join(' ');
  }

  calculateDonutSlices(values: number[], labels: string[], colors: string[]): Slice[] {
    const total = values.reduce((sum, v) => sum + v, 0);
    if (total === 0) {
      return [{
        label: 'No Data',
        value: 0,
        color: '#e2e8f0',
        percentage: 100,
        pathData: '',
        isFullCircle: true
      }];
    }

    const items = values.map((val, idx) => ({ val, label: labels[idx], color: colors[idx] }))
      .filter(item => item.val > 0);

    if (items.length === 1) {
      return [{
        label: items[0].label,
        value: items[0].val,
        color: items[0].color,
        percentage: 100,
        pathData: '',
        isFullCircle: true
      }];
    }

    let accumulatedAngle = 0;
    const slices: Slice[] = [];

    for (const item of items) {
      const pct = (item.val / total) * 100;
      const angle = (item.val / total) * 360;
      const startAngle = accumulatedAngle;
      const endAngle = accumulatedAngle + angle;
      accumulatedAngle = endAngle;

      const pathData = this.describeArc(100, 100, 80, startAngle, endAngle);

      slices.push({
        label: item.label,
        value: item.val,
        color: item.color,
        percentage: pct,
        pathData: pathData,
        isFullCircle: false
      });
    }

    return slices;
  }

  updateCharts(): void {
    if (!this.dashboard) return;

    // Calculate operational expenses (operating costs excluding distributor payments)
    const operationalExp = (this.dashboard.expWages || 0) +
      (this.dashboard.expBills || 0) +
      (this.dashboard.expMaintenance || 0) +
      (this.dashboard.expMisc || 0);

    // Financial Overview Slices
    const finValues = [
      this.dashboard.monthRevenue || 0,
      this.dashboard.paymentsToDistributors || 0,
      this.dashboard.customerDues || 0,
      this.dashboard.distributorPurchases || 0,
      this.dashboard.distributorDues || 0,
      this.dashboard.expiredCost || 0,
      operationalExp
    ];

    const finLabels = [
      'Monthly Sales',
      'Payments to Distributors',
      'Due of Customers',
      'Purchases',
      'Due for Distributors',
      'Expired Medicine Cost',
      'Operational Expenses'
    ];

    const finColors = [
      '#0d8b77', // Monthly Sales (Deep Teal)
      '#10b981', // Payments to Distributors (Emerald Green)
      '#f59e0b', // Due of Customers (Amber Orange)
      '#8b5cf6', // Purchases (Royal Purple)
      '#ef4444', // Due for Distributors (Vibrant Red)
      '#6366f1', // Expired Medicine Cost (Indigo)
      '#ec4899'  // Operational Expenses (Pink)
    ];

    this.financialTotal = finValues.reduce((a, b) => a + b, 0);
    this.financialSlices = this.calculateDonutSlices(finValues, finLabels, finColors);

    // Expenditure Slices
    const expValues = [
      this.dashboard.expWages || 0,
      this.dashboard.expBills || 0,
      this.dashboard.expMaintenance || 0,
      this.dashboard.expMisc || 0
    ];

    const expLabels = [
      'Monthly Wages',
      'Current Bills',
      'Maintenance Charges',
      'Misc Expenses'
    ];

    const expColors = [
      '#3b82f6', // Monthly Wages (Vibrant Blue)
      '#f59e0b', // Current Bills (Amber Orange)
      '#10b981', // Maintenance Charges (Emerald Green)
      '#6b7280'  // Misc Expenses (Cool Grey)
    ];

    this.expenditureTotal = expValues.reduce((a, b) => a + b, 0);
    this.expenditureSlices = this.calculateDonutSlices(expValues, expLabels, expColors);
  }

  reload(): void {
    if (this.csvCompositionMap.size === 0) {
      this.loadDefaultCompositionCsv();
    }
    this.api.dashboard().subscribe({
      next: data => {
        this.dashboard = data;
        this.updateCharts();
      },
      error: error => this.fail(error)
    });
    this.api.medicines().subscribe({
      next: data => {
        this.medicines = data;
        this.saleForm.items[0].medicineId ||= data[0]?.id ?? 0;
        if (this.batchForm.medicineId && !this.editingBatchId) {
          const selectedMed = this.medicines.find(m => m.id === this.batchForm.medicineId);
          if (selectedMed) {
            this.batchForm.gstPercentage = selectedMed.gstPercentage;
            this.batchForm.mrp = selectedMed.mrp;
            this.batchForm.sellingPrice = selectedMed.sellingPrice;
            this.batchForm.discount = Math.max(0, Number((selectedMed.mrp - selectedMed.sellingPrice).toFixed(2)));
          }
        }

        // Update selectedInventoryRow if on medicine-detail view
        if (this.view === 'medicine-detail' && this.selectedInventoryRow) {
          const currentMedId = this.selectedInventoryRow.medicine.id;
          const currentBatchId = this.selectedInventoryRow.batch.id;
          const updatedMed = data.find(m => m.id === currentMedId);
          if (updatedMed) {
            const updatedBatch = updatedMed.batches.find(b => b.id === currentBatchId);
            if (updatedBatch) {
              const today = new Date();
              const exp = new Date(updatedBatch.expiryDate);
              const diffTime = exp.getTime() - today.getTime();
              const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              let state: ExpiryState = 'valid';
              if (days <= 0) {
                state = 'expired';
              } else if (days <= this.nearExpiryDays) {
                state = 'near';
              }
              this.selectedInventoryRow = {
                medicine: updatedMed,
                batch: updatedBatch,
                daysUntilExpiry: days,
                expiryState: state
              };
            }
          }
        }
      }, error: error => this.fail(error)
    });
    this.api.distributors().subscribe({
      next: data => {
        this.distributors = data;
        this.batchForm.distributorId ||= data[0]?.id ?? 0;
      }, error: error => this.fail(error)
    });
    this.api.customers().subscribe({
      next: data => {
        this.customers = data;
        this.saleForm.customerId ||= data[0]?.id ?? 0;
      }, error: error => this.fail(error)
    });
    this.api.credits().subscribe({
      next: data => {
        this.credits = data;
        data.forEach(c => {
          if (!this.creditPaymentModes[c.id]) {
            this.creditPaymentModes[c.id] = 'CASH';
          }
        });
        this.updateGroupedCredits();

        if (data.length < 5) {
          this.api.seedTestCreditCustomers().subscribe({
            next: () => {
              this.api.credits().subscribe({
                next: refreshed => {
                  this.credits = refreshed;
                  this.updateGroupedCredits();
                }
              });
            },
            error: () => {}
          });
        }
      },
      error: error => this.fail(error)
    });
    this.api.sales().subscribe({ next: data => this.salesHistory = data || [], error: () => {} });
    if (this.role === 'ADMIN') {
      this.api.allDistributorBills().subscribe({ next: data => this.distributorBillsHistory = data, error: error => this.fail(error) });
      if (this.view === 'users' || this.view === 'user-form') {
        this.loadUsers();
      }
    }

    // Refresh view-specific page datasets
    if (this.view === 'dashboard' || this.view === 'sales-analytics') {
      this.loadAnalytics();
    } else if (this.view === 'distributor-ledger' && this.selectedDistributor) {
      this.loadDistributorLedgerData();
    } else if (this.view === 'distributor-comparison') {
      this.loadDistributorComparison();
    } else if (this.view === 'activity-log') {
      this.loadActivityLogs();
    } else if (this.view === 'store-config') {
      this.loadStoreConfig();
    } else if (this.view === 'credit-watch' || this.view === 'credits') {
      this.updateGroupedCredits();
      this.loadSettledCredits();
    }
  }

  show(view: View, clearHistory: boolean = true): void {
    if (clearHistory) {
      this.viewHistory = [];
    }
    this.view = view;
    this.message = '';
    this.confirmingCreditId = null;
    this.selectedReportCustomer = undefined;
    this.customerCreditHistory = [];
    this.expandedTxnId = null;
    if (view === 'sales-history') {
      this.ledgerDatePreset = '';
      this.ledgerStartDate = '';
      this.ledgerEndDate = '';
      this.ledgerStatusFilter = '';
    }
    if (view !== 'inventory-form') {
      this.editingMedicineId = undefined;
      this.editingBatchId = undefined;
      this.originalMedicineObj = null;
      this.originalBatchObj = null;
    }
    if (view !== 'user-form') {
      this.editingUserId = undefined;
    }
    if (view === 'distributor-ledger' && this.selectedDistributor) {
      this.loadDistributorLedgerData();
    }
    if (view === 'distributor-comparison') {
      this.loadDistributorComparison();
    }
    if (view === 'activity-log') {
      this.loadActivityLogs();
    }
    if (view === 'dashboard' || view === 'sales-analytics') {
      this.loadAnalytics();
    }
    if (view === 'users') {
      this.loadUsers();
    }
    if (view === 'credit-watch' || view === 'credits') {
      this.updateGroupedCredits();
    }
  }

  goBack(): void {
    if (this.viewHistory.length > 0) {
      const prev = this.viewHistory.pop();
      if (prev) {
        this.show(prev, false);
      }
    } else {
      this.show('dashboard');
    }
  }

  loadUsers(): void {
    this.busy = true;
    this.api.getUsers().subscribe({
      next: data => {
        this.usersList = data;
      },
      error: error => this.fail(error),
      complete: () => this.busy = false
    });
  }

  openAddUser(): void {
    if (this.view !== 'user-form') {
      this.viewHistory.push(this.view);
    }
    this.editingUserId = undefined;
    this.resetUserForm();
    this.view = 'user-form';
    this.message = '';
  }

  editUser(user: UserView): void {
    if (this.view !== 'user-form') {
      this.viewHistory.push(this.view);
    }
    this.editingUserId = user.id;
    this.userForm = {
      username: user.username,
      password: '',
      fullName: user.fullName,
      mobile: user.mobile || '',
      email: user.email || '',
      role: user.role,
      active: user.active,
      otp: ''
    };
    this.originalEditingMobile = user.mobile || '';
    this.updateMobileOtpSent = false;
    this.view = 'user-form';
    this.message = '';
  }

  resetUserForm(): void {
    this.userForm = {
      username: '',
      password: '',
      fullName: '',
      mobile: '',
      email: '',
      role: 'STAFF' as Role,
      active: true,
      otp: ''
    };
    this.originalEditingMobile = '';
    this.updateMobileOtpSent = false;
  }

  saveUser(): void {
    if (!this.userForm.username.trim() || !this.userForm.fullName.trim()) {
      this.message = 'Error: Username and Full Name are required.';
      return;
    }
    if (!this.userForm.mobile || !this.userForm.mobile.trim()) {
      this.message = 'Error: Mobile number is required.';
      return;
    }
    if (!/^\d{10}$/.test(this.userForm.mobile.trim())) {
      this.message = 'Error: Mobile number must be exactly 10 digits (numeric only).';
      return;
    }
    if (!this.userForm.email || !this.userForm.email.trim()) {
      this.message = 'Error: Email address is required.';
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.userForm.email.trim())) {
      this.message = 'Error: Invalid email format.';
      return;
    }

    this.busy = true;
    const payload = {
      username: this.userForm.username.trim(),
      fullName: this.userForm.fullName.trim(),
      mobile: this.userForm.mobile.trim(),
      email: this.userForm.email.trim(),
      role: this.userForm.role,
      active: this.userForm.active,
      otp: this.userForm.otp.trim()
    } as any;

    const request = this.editingUserId
      ? this.api.updateUser(this.editingUserId, payload)
      : this.api.createUser(payload);

    request.subscribe({
      next: () => {
        this.message = `User account successfully ${this.editingUserId ? 'updated' : 'created'}.`;
        this.show('users');
      },
      error: error => this.fail(error),
      complete: () => this.busy = false
    });
  }

  sendAdminOtp(): void {
    if (!this.userForm.mobile || !this.userForm.mobile.trim()) {
      this.message = 'Error: Mobile number is required.';
      return;
    }
    if (!/^\d{10}$/.test(this.userForm.mobile.trim())) {
      this.message = 'Error: Mobile number must be exactly 10 digits (numeric only).';
      return;
    }

    this.busy = true;
    this.message = '';

    if (this.editingUserId) {
      // Mobile update
      this.api.sendUpdateMobileOtp(this.editingUserId, this.userForm.mobile.trim()).subscribe({
        next: () => {
          this.updateMobileOtpSent = true;
          this.message = 'Update verification OTP sent successfully to the new mobile number via WhatsApp!';
        },
        error: error => this.fail(error),
        complete: () => this.busy = false
      });
    } else {
      // New user registration OTP
      if (!this.userForm.username.trim() || !this.userForm.email.trim()) {
        this.busy = false;
        this.message = 'Error: Username and Email are required before sending OTP.';
        return;
      }
      this.api.sendRegistrationOtp({
        username: this.userForm.username.trim(),
        mobile: this.userForm.mobile.trim(),
        email: this.userForm.email.trim()
      }).subscribe({
        next: () => {
          this.updateMobileOtpSent = true;
          this.message = 'Verification OTP sent successfully to the mobile number via WhatsApp!';
        },
        error: error => this.fail(error),
        complete: () => this.busy = false
      });
    }
  }

  toggleUserStatus(user: UserView): void {
    if (user.username === this.login.username || user.fullName === this.user) {
      this.message = "Error: You cannot lock/unlock your own account.";
      return;
    }
    this.busy = true;
    this.api.toggleUserActive(user.id, !user.active).subscribe({
      next: () => {
        this.message = `User account status updated.`;
        this.loadUsers();
      },
      error: error => this.fail(error),
      complete: () => this.busy = false
    });
  }

  openResetPassword(user: UserView): void {
    this.resetPasswordTargetUser = user;
    this.resetPasswordForm.password = '';
    this.showResetPasswordModal = true;
  }

  closeResetPassword(): void {
    this.showResetPasswordModal = false;
    this.resetPasswordTargetUser = undefined;
  }

  submitResetPassword(): void {
    if (!this.resetPasswordTargetUser) return;
    this.busy = true;
    this.api.resetUserPassword(this.resetPasswordTargetUser.id, { password: 'dummyPassword123!' }).subscribe({
      next: () => {
        this.message = `Temporary password has been generated and sent to ${this.resetPasswordTargetUser?.username} via WhatsApp.`;
        this.closeResetPassword();
      },
      error: error => this.fail(error),
      complete: () => this.busy = false
    });
  }

  confirmDeleteUser(user: UserView): void {
    this.deleteTargetUser = user;
    this.deleteOtpSent = false;
    this.deleteOtpCode = '';
    this.deleteErrorMessage = '';
    this.showDeleteUserModal = true;
  }

  closeDeleteUser(): void {
    this.showDeleteUserModal = false;
    this.deleteTargetUser = undefined;
    this.deleteOtpSent = false;
    this.deleteOtpCode = '';
    this.deleteErrorMessage = '';
  }

  sendDeleteOtp(): void {
    if (!this.deleteTargetUser) return;
    this.busy = true;
    this.deleteErrorMessage = '';
    this.api.sendDeleteUserOtp(this.deleteTargetUser.id).subscribe({
      next: () => {
        this.deleteOtpSent = true;
        this.busy = false;
      },
      error: error => {
        this.deleteErrorMessage = error.error?.message || error.message || 'Failed to send OTP.';
        this.busy = false;
      }
    });
  }

  submitDeleteUser(): void {
    if (!this.deleteTargetUser || !this.deleteOtpCode) return;
    this.busy = true;
    this.deleteErrorMessage = '';
    this.api.deleteUser(this.deleteTargetUser.id, this.deleteOtpCode).subscribe({
      next: () => {
        this.message = `Successfully deleted user account: ${this.deleteTargetUser?.username}`;
        this.closeDeleteUser();
        this.loadUsers();
      },
      error: error => {
        this.deleteErrorMessage = error.error?.message || error.message || 'Verification and deletion failed.';
        this.busy = false;
      }
    });
  }

  toggleRegisterView(show: boolean): void {
    this.showRegisterForm = show;
    this.showForgotPasswordForm = false;
    this.registerStep = 1;
    this.message = '';
    this.registerMessage = '';
    this.registerSuccess = '';
    this.registerForm = {
      username: '',
      password: '',
      fullName: '',
      mobile: '',
      email: '',
      otp: ''
    };
  }

  sendRegistrationOtp(): void {
    if (!this.registerForm.username.trim() || !this.registerForm.fullName.trim() ||
      !this.registerForm.mobile.trim() || !this.registerForm.email.trim() ||
      !this.registerForm.password.trim()) {
      this.registerMessage = 'Error: All fields are mandatory.';
      return;
    }
    if (!/^\d{10}$/.test(this.registerForm.mobile.trim())) {
      this.registerMessage = 'Error: Mobile number must be exactly 10 digits (numeric only).';
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.registerForm.email.trim())) {
      this.registerMessage = 'Error: Invalid email format.';
      return;
    }
    const strength = this.checkPasswordStrength(this.registerForm.password);
    if (!strength.valid) {
      this.registerMessage = 'Error: Password does not meet security complexity requirements.';
      return;
    }

    this.busy = true;
    this.registerMessage = '';
    this.registerSuccess = '';

    this.api.sendRegistrationOtp({
      username: this.registerForm.username.trim(),
      mobile: this.registerForm.mobile.trim(),
      email: this.registerForm.email.trim()
    }).subscribe({
      next: () => {
        this.registerStep = 2;
        this.registerSuccess = 'OTP sent successfully to your WhatsApp!';
      },
      error: error => {
        this.fail(error);
        this.registerMessage = this.message || 'Error: Failed to send OTP.';
        this.message = '';
      },
      complete: () => this.busy = false
    });
  }

  register(): void {
    if (!this.registerForm.otp.trim()) {
      this.registerMessage = 'Error: OTP is required.';
      return;
    }

    this.busy = true;
    this.registerMessage = '';
    this.registerSuccess = '';

    const payload = {
      username: this.registerForm.username.trim(),
      password: this.registerForm.password.trim(),
      fullName: this.registerForm.fullName.trim(),
      mobile: this.registerForm.mobile.trim(),
      email: this.registerForm.email.trim(),
      otp: this.registerForm.otp.trim()
    };

    this.api.register(payload).subscribe({
      next: () => {
        this.registerSuccess = 'Registration successful! Returning to login...';
        this.registerForm = {
          username: '',
          password: '',
          fullName: '',
          mobile: '',
          email: '',
          otp: ''
        };
        this.registerStep = 1;
        setTimeout(() => {
          this.toggleRegisterView(false);
          this.message = 'Account created successfully! Please sign in.';
        }, 2000);
      },
      error: error => {
        this.fail(error);
        this.registerMessage = this.message || 'Error: Registration failed.';
        this.message = '';
      },
      complete: () => this.busy = false
    });
  }

  sendUpdateMobileOtp(): void {
    if (!this.editingUserId) return;
    if (!this.userForm.mobile || !this.userForm.mobile.trim()) {
      this.message = 'Error: Mobile number is required.';
      return;
    }
    this.busy = true;
    this.message = '';
    this.api.sendUpdateMobileOtp(this.editingUserId, this.userForm.mobile.trim()).subscribe({
      next: () => {
        this.updateMobileOtpSent = true;
        this.message = 'Update verification OTP sent successfully to the new mobile number via WhatsApp!';
      },
      error: error => this.fail(error),
      complete: () => this.busy = false
    });
  }

  get pageTitle(): string {
    switch (this.view) {
      case 'stock-watch':
        return 'Stock Watch';
      case 'credit-watch':
        return 'Credit Watch';
      case 'inventory-form':
        if (this.editingBatchId) {
          return 'Edit Batch';
        }
        return this.editingMedicineId ? 'Edit Medicine' : 'Add Medicine / Receive Batch';
      case 'distributor-form':
        return this.editingDistributorId ? 'Edit Distributor' : 'Add Distributor';
      case 'expiry':
        return 'Expiry Control';
      case 'distributor-ledger':
        return `${this.selectedDistributor?.name} - Ledger Board`;
      case 'distributor-invoice':
        return `Distributor Invoice: ${this.selectedDistributorBill?.billNo}`;
      case 'medicine-detail':
        return `Medicine Details: ${this.selectedInventoryRow?.medicine.name || ''}`;
      case 'profits-losses':
        return 'Profits & Losses Projection Board';
      case 'bulk-upload':
        return 'Bulk Distributor Bill Upload';
      case 'sales-history':
        return 'Sales History';
      case 'distributor-comparison':
        return 'Distributor Price Comparison';
      case 'activity-log':
        return 'Activity Log / Audit Trail';
      case 'csv-master':
        return 'Master CSV Data Upload';
      case 'users':
        return 'User Accounts';
      case 'user-form':
        return this.editingUserId ? 'Edit User Account' : 'Add User Account';
      case 'sales-analytics':
        return 'Sales Analytics';
      case 'ai-pharmacist':
        return 'AI Pharmacist';
      case 'know-your-medicine':
        return 'Know About Your Medicine';
      default:
        return this.view[0].toUpperCase() + this.view.slice(1);
    }
  }

  getSalesInPlDateRange(): Sale[] {
    if (!this.plStartDate && !this.plEndDate) {
      return this.salesHistory;
    }
    return this.salesHistory.filter(sale => {
      const saleDate = (sale.createdAt || (sale as any).saleDate || (sale as any).date || '').slice(0, 10);
      if (!saleDate) return true;
      if (this.plStartDate && saleDate < this.plStartDate) return false;
      if (this.plEndDate && saleDate > this.plEndDate) return false;
      return true;
    });
  }

  getBillPurchaseCost(bill: DistributorBillView): number {
    return bill.netAmount || 0;
  }

  getBillSalesTillNow(bill: DistributorBillView): number {
    if (!bill || !bill.items || bill.items.length === 0) return 0;
    const batchNos = new Set(bill.items.map(i => i.batchNo).filter(Boolean));
    const salesInPeriod = this.getSalesInPlDateRange();
    let totalSales = 0;
    for (const sale of salesInPeriod) {
      for (const item of (sale.items || [])) {
        if (item.batchNo && batchNos.has(item.batchNo)) {
          totalSales += this.actualItemAmount(sale, item);
        }
      }
    }
    return Number(totalSales.toFixed(2));
  }

  getBillRealizedProfit(bill: DistributorBillView): number {
    if (!bill || !bill.items || bill.items.length === 0) return 0;
    const batchPurchaseRates = new Map<string, number>();
    for (const item of bill.items) {
      if (item.batchNo) {
        const rate = (item as any).purchaseRate || (item as any).purchasePrice || 0;
        const gst = item.gstPercentage || 0;
        const rateWithGst = rate * (1 + gst / 100);
        batchPurchaseRates.set(item.batchNo, rateWithGst > 0 ? rateWithGst : rate);
      }
    }

    const salesInPeriod = this.getSalesInPlDateRange();
    let totalRevenue = 0;
    let totalCostOfSoldGoods = 0;

    for (const sale of salesInPeriod) {
      for (const item of (sale.items || [])) {
        if (item.batchNo && batchPurchaseRates.has(item.batchNo)) {
          const revenue = this.actualItemAmount(sale, item);
          const costRate = batchPurchaseRates.get(item.batchNo) || 0;
          const packSize = this.getPackSize((item as any).medicine || item);
          const cost = (costRate / packSize) * Math.round((item.quantity || 0) * packSize);

          totalRevenue += revenue;
          totalCostOfSoldGoods += cost;
        }
      }
    }

    return Number((totalRevenue - totalCostOfSoldGoods).toFixed(2));
  }

  getItemSalesTillNow(billItem: any): number {
    if (!billItem || !billItem.batchNo) return 0;
    const salesInPeriod = this.getSalesInPlDateRange();
    let totalSales = 0;
    for (const sale of salesInPeriod) {
      for (const item of (sale.items || [])) {
        if (item.batchNo === billItem.batchNo) {
          totalSales += this.actualItemAmount(sale, item);
        }
      }
    }
    return Number(totalSales.toFixed(2));
  }

  getItemRealizedProfit(billItem: any): number {
    if (!billItem || !billItem.batchNo) return 0;
    const sales = this.getItemSalesTillNow(billItem);
    const salesInPeriod = this.getSalesInPlDateRange();
    let totalUnitsSold = 0;
    for (const sale of salesInPeriod) {
      for (const item of (sale.items || [])) {
        if (item.batchNo === billItem.batchNo) {
          const packSize = this.getPackSize((item as any).medicine || item);
          totalUnitsSold += Math.round((item.quantity || 0) * packSize);
        }
      }
    }
    const costRate = (billItem as any).purchaseRate || (billItem as any).purchasePrice || 0;
    const gst = billItem.gstPercentage || 0;
    const costRateWithGst = costRate * (1 + gst / 100);
    const effectiveCostRate = costRateWithGst > 0 ? costRateWithGst : costRate;
    const packSize = this.getPackSize((billItem as any).medicine || billItem);
    const totalCostOfSoldGoods = (effectiveCostRate / packSize) * totalUnitsSold;

    return Number((sales - totalCostOfSoldGoods).toFixed(2));
  }

  getBillActualSellingValue(bill: DistributorBillView): number {
    if (!bill.items) return 0;
    return bill.items.reduce((sum, item) => {
      const sellPrice = (item.sellingPrice && item.sellingPrice > 0) ? item.sellingPrice : (item.mrp || 0);
      return sum + (sellPrice * (item.quantity || 0));
    }, 0);
  }

  getBillMrpTotal(bill: DistributorBillView): number {
    if (!bill.items) return 0;
    return bill.items.reduce((sum, item) => sum + ((item.mrp || 0) * (item.quantity || 0)), 0);
  }

  getBillActualProfit(bill: DistributorBillView): number {
    return this.getBillActualSellingValue(bill) - this.getBillPurchaseCost(bill);
  }

  getBillProjectedProfit(bill: DistributorBillView): number {
    return this.getBillMrpTotal(bill) - this.getBillPurchaseCost(bill);
  }

  getBillDiscountAmount(bill: DistributorBillView): number {
    const batchNos = new Set((bill.items || []).map(i => i.batchNo).filter(Boolean));
    const salesInPeriod = this.getSalesInPlDateRange();
    let periodDiscounts = 0;
    for (const sale of salesInPeriod) {
      for (const item of (sale.items || [])) {
        if (item.batchNo && batchNos.has(item.batchNo)) {
          periodDiscounts += this.actualDiscount(sale, item) * (item.quantity || 0);
        }
      }
    }
    if (periodDiscounts > 0) return Number(periodDiscounts.toFixed(2));
    return Number((this.getBillMrpTotal(bill) - this.getBillActualSellingValue(bill)).toFixed(2));
  }

  get totalActualBillSales(): number {
    return this.filteredDistributorBillsHistory().reduce((sum, b) => sum + this.getBillActualSellingValue(b), 0);
  }

  get totalBillPurchaseCostWithGst(): number {
    return this.filteredDistributorBillsHistory().reduce((sum, b) => sum + this.getBillPurchaseCost(b), 0);
  }

  get totalBillSalesTillNow(): number {
    return this.filteredDistributorBillsHistory().reduce((sum, b) => sum + this.getBillSalesTillNow(b), 0);
  }

  get totalBillRealizedProfit(): number {
    return this.filteredDistributorBillsHistory().reduce((sum, b) => sum + this.getBillRealizedProfit(b), 0);
  }

  get totalBillActualProfit(): number {
    return this.filteredDistributorBillsHistory().reduce((sum, b) => sum + this.getBillActualProfit(b), 0);
  }

  get totalBillProjectedProfit(): number {
    return this.filteredDistributorBillsHistory().reduce((sum, b) => sum + this.getBillProjectedProfit(b), 0);
  }

  get filteredMedicines(): Medicine[] {
    const query = this.inventorySearch.trim().toLowerCase();
    if (!query) {
      return this.medicines;
    }
    const matches = this.medicines.filter(medicine => [
      medicine.code,
      medicine.name,
      medicine.genericName,
      medicine.manufacturer,
      medicine.category,
      ...medicine.batches.map(batch => batch.batchNo)
    ].filter(Boolean).some(value => value.toLowerCase().includes(query)));

    return matches.sort((a, b) => {
      const scoreA = getMedicineSearchRelevanceScore(a, query);
      const scoreB = getMedicineSearchRelevanceScore(b, query);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.name.localeCompare(b.name);
    });
  }

  get allFilteredInventoryRows(): InventoryRow[] {
    const allRows = this.rowsFor(this.medicines);
    if (this.alternateGenericSearch) {
      const targetGen = this.alternateGenericSearch.trim().toLowerCase();
      return allRows.filter(row =>
        row.medicine.genericName &&
        row.medicine.genericName.toLowerCase() === targetGen &&
        row.medicine.id !== this.excludeMedicineId
      );
    }
    return this.rowsFor(this.filteredMedicines);
  }

  get inventoryRows(): InventoryRow[] {
    const rows = this.allFilteredInventoryRows;
    const start = this.inventoryPageIndex * this.inventoryPageSize;
    return rows.slice(start, start + this.inventoryPageSize);
  }

  hasDiscount(row: InventoryRow): boolean {
    if (!row || !row.batch) return false;
    const mrp = row.batch.mrp || row.medicine?.mrp || 0;
    const sp = row.batch.sellingPrice || row.medicine?.sellingPrice || 0;
    const pct = (row.batch as any).discountPercentage || (row.batch as any).discount || 0;
    return pct > 0 || (mrp > 0 && sp > 0 && sp < mrp);
  }

  getDiscountPct(row: InventoryRow): number {
    if (!row || !row.batch) return 0;
    const mrp = row.batch.mrp || row.medicine?.mrp || 0;
    const sp = row.batch.sellingPrice || row.medicine?.sellingPrice || 0;
    if (mrp > 0 && sp > 0 && sp < mrp) {
      return Math.round(((mrp - sp) / mrp) * 100);
    }
    return Number((row.batch as any).discountPercentage || 0);
  }

  trackByRow(index: number, row: InventoryRow): string {
    return `${row.medicine.id}-${row.batch.id}`;
  }

  getInventoryTotalPages(): number {
    return Math.ceil(this.allFilteredInventoryRows.length / this.inventoryPageSize) || 1;
  }

  viewMedicineDetails(row: InventoryRow): void {
    if (this.view !== 'medicine-detail') {
      this.viewHistory.push(this.view);
    }
    this.selectedInventoryRow = row;
    this.show('medicine-detail', false);
  }

  searchAlternatives(row: InventoryRow): void {
    this.alternateGenericSearch = row.medicine.genericName || '';
    this.excludeMedicineId = row.medicine.id;
    this.inventoryPageIndex = 0;
    this.show('inventory');
  }

  clearAlternateSearch(): void {
    this.alternateGenericSearch = '';
    this.excludeMedicineId = undefined;
    this.inventoryPageIndex = 0;
  }

  getDistributorDetailsByName(name: string): Distributor | undefined {
    if (!name) return undefined;
    return this.distributors.find(d => d.name.toLowerCase() === name.toLowerCase());
  }

  get expiryRows(): InventoryRow[] {
    const query = this.expirySearch.trim().toLowerCase();
    const rows = this.rowsFor(this.medicines).filter(row => row.expiryState === this.expiryScope && (row.batch.availableQuantity > 0 || (row.batch.looseUnitsAvailable || 0) > 0));
    const searched = !query ? rows : rows.filter(row => [
      row.medicine.code,
      row.medicine.name,
      row.medicine.genericName,
      row.medicine.manufacturer,
      row.batch.batchNo,
      row.batch.distributorName
    ].filter(Boolean).some(value => value.toLowerCase().includes(query)));
    return [...searched].sort((first, second) => {
      switch (this.expirySort) {
        case 'expiry-desc':
          return second.batch.expiryDate.localeCompare(first.batch.expiryDate);
        case 'medicine':
          return first.medicine.name.localeCompare(second.medicine.name);
        case 'quantity':
          return this.getBatchTotalUnits(first.batch, first.medicine) - this.getBatchTotalUnits(second.batch, second.medicine);
        default:
          return first.batch.expiryDate.localeCompare(second.batch.expiryDate);
      }
    });
  }

  openAddMedicine(): void {
    if (this.view !== 'inventory-form') {
      this.viewHistory.push(this.view);
    }
    this.editingMedicineId = undefined;
    this.editingBatchId = undefined;
    this.resetMedicineForm();
    this.resetBatchForm();
    this.view = 'inventory-form';
    this.message = '';
  }

  editMedicine(medicine: Medicine): void {
    if (this.view !== 'inventory-form') {
      this.viewHistory.push(this.view);
    }
    this.editingMedicineId = medicine.id;
    this.originalMedicineObj = JSON.parse(JSON.stringify(medicine));
    if (this.selectedInventoryRow && this.selectedInventoryRow.batch) {
      const batch = this.selectedInventoryRow.batch;
      this.editingBatchId = batch.id;
      this.originalBatchObj = JSON.parse(JSON.stringify(batch));
      this.batchForm = {
        medicineId: medicine.id,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        purchasePrice: batch.purchasePrice,
        sellingPrice: batch.sellingPrice,
        quantity: batch.availableQuantity,
        availableQuantity: batch.availableQuantity,
        distributorId: 0,
        billNo: '',
        billDate: '',
        dueDate: '',
        gstPercentage: medicine.gstPercentage,
        mrp: batch.mrp ?? medicine.mrp ?? 0,
        discount: Math.max(0, Number(((batch.mrp ?? medicine.mrp ?? 0) - batch.sellingPrice).toFixed(2)))
      };
    } else {
      this.editingBatchId = undefined;
      this.originalBatchObj = null;
      this.batchForm.medicineId = medicine.id;
      this.batchForm.gstPercentage = medicine.gstPercentage;
      this.batchForm.mrp = medicine.mrp;
      this.batchForm.sellingPrice = medicine.sellingPrice;
      this.batchForm.discount = Math.max(0, Number((medicine.mrp - medicine.sellingPrice).toFixed(2)));
    }
    this.medicineForm = {
      code: medicine.code,
      name: medicine.name,
      genericName: medicine.genericName,
      manufacturer: medicine.manufacturer,
      category: medicine.category,
      hsnCode: medicine.hsnCode,
      gstPercentage: medicine.gstPercentage,
      mrp: medicine.mrp,
      sellingPrice: medicine.sellingPrice,
      discount: Math.max(0, Number((medicine.mrp - medicine.sellingPrice).toFixed(2))),
      prescriptionRequired: medicine.prescriptionRequired,
      stockWatchQty: medicine.stockWatchQty,
      sideEffects: medicine.sideEffects || ''
    };
    this.view = 'inventory-form';
    this.message = '';
  }

  isMedicineChanged(newPayload: any): boolean {
    if (!this.originalMedicineObj) return true;
    const keys: (keyof Medicine)[] = [
      'code', 'name', 'genericName', 'manufacturer', 'category', 'hsnCode',
      'prescriptionRequired', 'stockWatchQty', 'sideEffects', 'gstPercentage', 'mrp', 'sellingPrice'
    ];
    return keys.some(key => newPayload[key] !== this.originalMedicineObj![key]);
  }

  isBatchChanged(newPayload: any): boolean {
    if (!this.originalBatchObj) return true;
    const keys = [
      'batchNo', 'expiryDate', 'purchasePrice', 'sellingPrice', 'mrp', 'availableQuantity'
    ];
    return keys.some(key => newPayload[key] !== (this.originalBatchObj as any)[key]);
  }

  saveMedicine(): void {
    if (this.medicineForm.sellingPrice > this.medicineForm.mrp) {
      this.message = 'Error: Selling Price cannot be greater than MRP.';
      return;
    }

    // If not editing, proceed with create
    if (!this.editingMedicineId) {
      const { discount, ...payload } = this.medicineForm;
      this.api.createMedicine(payload).subscribe({
        next: medicine => {
          this.batchForm.medicineId = medicine.id;
          this.batchForm.gstPercentage = medicine.gstPercentage;
          this.batchForm.mrp = medicine.mrp;
          this.batchForm.sellingPrice = medicine.sellingPrice;
          this.batchForm.discount = Math.max(0, Number((medicine.mrp - medicine.sellingPrice).toFixed(2)));
          this.message = `${medicine.name} added in the medicine master.`;
          this.editingMedicineId = undefined;
          this.editingBatchId = undefined;
          this.originalMedicineObj = null;
          this.originalBatchObj = null;
          this.view = 'inventory';
          this.reload();
        },
        error: error => this.fail(error)
      });
      return;
    }

    // We are editing medicine specs (and possibly batch info)
    const newMedPayload = {
      code: this.medicineForm.code,
      name: this.medicineForm.name,
      genericName: this.medicineForm.genericName,
      manufacturer: this.medicineForm.manufacturer,
      category: this.medicineForm.category,
      hsnCode: this.medicineForm.hsnCode,
      prescriptionRequired: this.medicineForm.prescriptionRequired,
      stockWatchQty: this.medicineForm.stockWatchQty,
      sideEffects: this.medicineForm.sideEffects,
      gstPercentage: this.editingBatchId ? this.batchForm.gstPercentage : this.medicineForm.gstPercentage,
      mrp: this.editingBatchId ? this.batchForm.mrp : this.medicineForm.mrp,
      sellingPrice: this.editingBatchId ? this.batchForm.sellingPrice : this.medicineForm.sellingPrice
    };

    const newBatchPayload = this.editingBatchId ? {
      batchNo: this.batchForm.batchNo,
      expiryDate: this.batchForm.expiryDate,
      purchasePrice: this.batchForm.purchasePrice,
      sellingPrice: this.batchForm.sellingPrice,
      mrp: this.batchForm.mrp,
      availableQuantity: this.batchForm.availableQuantity
    } : null;

    const medicineChanged = this.isMedicineChanged(newMedPayload);
    const batchChanged = newBatchPayload ? this.isBatchChanged(newBatchPayload) : false;

    if (!medicineChanged && !batchChanged) {
      this.message = 'No changes detected. Medicine specifications and batch details are already up-to-date.';
      this.editingMedicineId = undefined;
      this.editingBatchId = undefined;
      this.originalMedicineObj = null;
      this.originalBatchObj = null;
      this.view = 'inventory';
      return;
    }

    const proceedWithBatchUpdate = () => {
      if (batchChanged && this.editingBatchId && newBatchPayload) {
        this.api.updateBatch(this.editingBatchId, newBatchPayload).subscribe({
          next: batch => {
            this.message = `Batch ${batch.batchNo} and medicine properties updated.`;
            this.editingMedicineId = undefined;
            this.editingBatchId = undefined;
            this.originalMedicineObj = null;
            this.originalBatchObj = null;
            this.resetBatchForm();
            this.view = 'inventory';
            this.reload();
          },
          error: error => this.fail(error)
        });
      } else {
        this.message = 'Medicine properties updated.';
        this.editingMedicineId = undefined;
        this.editingBatchId = undefined;
        this.originalMedicineObj = null;
        this.originalBatchObj = null;
        this.resetBatchForm();
        this.view = 'inventory';
        this.reload();
      }
    };

    if (medicineChanged) {
      this.api.updateMedicine(this.editingMedicineId, newMedPayload).subscribe({
        next: () => {
          proceedWithBatchUpdate();
        },
        error: error => this.fail(error)
      });
    } else {
      proceedWithBatchUpdate();
    }
  }

  onMrpChange(): void {
    const mrp = this.medicineForm.mrp || 0;
    const sellPrice = this.medicineForm.sellingPrice || 0;
    this.medicineForm.discount = Math.max(0, Number((mrp - sellPrice).toFixed(2)));
  }

  onSellingPriceChange(): void {
    const mrp = this.medicineForm.mrp || 0;
    const sellPrice = this.medicineForm.sellingPrice || 0;
    this.medicineForm.discount = Math.max(0, Number((mrp - sellPrice).toFixed(2)));
  }

  onMedicineFormDiscountChange(): void {
    const mrp = this.medicineForm.mrp || 0;
    const discount = this.medicineForm.discount || 0;
    this.medicineForm.sellingPrice = Math.max(0, Number((mrp - discount).toFixed(2)));
  }

  onBatchMrpChange(): void {
    const mrp = this.batchForm.mrp || 0;
    const sellPrice = this.batchForm.sellingPrice || 0;
    this.batchForm.discount = Math.max(0, Number((mrp - sellPrice).toFixed(2)));
  }

  onBatchSellingPriceChange(): void {
    const mrp = this.batchForm.mrp || 0;
    const sellPrice = this.batchForm.sellingPrice || 0;
    this.batchForm.discount = Math.max(0, Number((mrp - sellPrice).toFixed(2)));
  }

  onBatchDiscountChange(): void {
    const mrp = this.batchForm.mrp || 0;
    const discount = this.batchForm.discount || 0;
    this.batchForm.sellingPrice = Math.max(0, Number((mrp - discount).toFixed(2)));
  }

  onBatchMedicineChange(): void {
    const medicine = this.medicines.find(m => m.id === this.batchForm.medicineId);
    if (medicine) {
      this.batchForm.gstPercentage = medicine.gstPercentage;
      this.batchForm.mrp = medicine.mrp;
      this.batchForm.sellingPrice = medicine.sellingPrice;
      this.batchForm.discount = Math.max(0, Number((medicine.mrp - medicine.sellingPrice).toFixed(2)));
    } else {
      this.batchForm.gstPercentage = 12;
      this.batchForm.mrp = 0;
      this.batchForm.sellingPrice = 0;
      this.batchForm.discount = 0;
    }
  }

  receiveBatch(): void {
    if (this.batchForm.sellingPrice > this.batchForm.mrp) {
      this.message = 'Error: Selling Price cannot be greater than MRP.';
      return;
    }
    const payload = {
      ...this.batchForm,
      distributorId: this.batchForm.distributorId || null
    };
    const medicine = this.medicines.find(m => m.id === this.batchForm.medicineId);
    if (medicine) {
      const medPayload = {
        code: medicine.code,
        name: medicine.name,
        genericName: medicine.genericName,
        manufacturer: medicine.manufacturer,
        category: medicine.category,
        hsnCode: medicine.hsnCode,
        prescriptionRequired: medicine.prescriptionRequired,
        stockWatchQty: medicine.stockWatchQty,
        sideEffects: medicine.sideEffects || '',
        gstPercentage: this.batchForm.gstPercentage,
        mrp: this.batchForm.mrp,
        sellingPrice: this.batchForm.sellingPrice
      };
      this.api.updateMedicine(medicine.id, medPayload).subscribe({
        next: () => {
          this.api.receiveBatch(payload).subscribe({
            next: batch => {
              this.message = `Batch ${batch.batchNo} received and medicine pricing aligned.`;
              this.resetBatchForm();
              this.reload();
            },
            error: error => this.fail(error)
          });
        },
        error: error => this.fail(error)
      });
    } else {
      this.api.receiveBatch(payload).subscribe({
        next: batch => {
          this.message = `Batch ${batch.batchNo} received.`;
          this.resetBatchForm();
          this.reload();
        },
        error: error => this.fail(error)
      });
    }
  }

  editBatch(batch: Batch, medicineId: number): void {
    if (this.view !== 'inventory-form') {
      this.viewHistory.push(this.view);
    }
    this.editingBatchId = batch.id;
    this.originalBatchObj = JSON.parse(JSON.stringify(batch));
    const medicine = this.medicines.find(m => m.id === medicineId);
    if (medicine) {
      this.editingMedicineId = medicine.id;
      this.originalMedicineObj = JSON.parse(JSON.stringify(medicine));
      this.medicineForm = {
        code: medicine.code,
        name: medicine.name,
        genericName: medicine.genericName,
        manufacturer: medicine.manufacturer,
        category: medicine.category,
        hsnCode: medicine.hsnCode,
        gstPercentage: medicine.gstPercentage,
        mrp: medicine.mrp,
        sellingPrice: medicine.sellingPrice,
        discount: Math.max(0, Number((medicine.mrp - medicine.sellingPrice).toFixed(2))),
        prescriptionRequired: medicine.prescriptionRequired,
        stockWatchQty: medicine.stockWatchQty,
        sideEffects: medicine.sideEffects || ''
      };
    } else {
      this.editingMedicineId = undefined;
      this.originalMedicineObj = null;
    }
    this.batchForm = {
      medicineId: medicineId,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      purchasePrice: batch.purchasePrice,
      sellingPrice: batch.sellingPrice,
      quantity: batch.availableQuantity,
      availableQuantity: batch.availableQuantity,
      distributorId: 0,
      billNo: '',
      billDate: '',
      dueDate: '',
      gstPercentage: medicine?.gstPercentage ?? 12,
      mrp: batch.mrp ?? medicine?.mrp ?? 0,
      discount: Math.max(0, Number(((batch.mrp ?? medicine?.mrp ?? 0) - batch.sellingPrice).toFixed(2)))
    };
    this.view = 'inventory-form';
    this.message = '';
  }

  cancelEditBatch(): void {
    this.editingBatchId = undefined;
    this.editingMedicineId = undefined;
    this.originalMedicineObj = null;
    this.originalBatchObj = null;
    this.resetBatchForm();
    this.view = 'inventory';
  }

  saveBatch(): void {
    if (this.batchForm.sellingPrice > this.batchForm.mrp) {
      this.message = 'Error: Selling Price cannot be greater than MRP.';
      return;
    }
    if (this.editingBatchId) {
      // Delegate to saveMedicine for unified change detection
      this.saveMedicine();
      return;
    }
    // Else, receive new batch
    this.receiveBatch();
  }

  openAddDistributor(): void {
    if (this.view !== 'distributor-form') {
      this.viewHistory.push(this.view);
    }
    this.editingDistributorId = undefined;
    this.resetDistributorForm();
    this.view = 'distributor-form';
    this.message = '';
  }

  editDistributor(distributor: Distributor): void {
    if (this.view !== 'distributor-form') {
      this.viewHistory.push(this.view);
    }
    this.editingDistributorId = distributor.id;
    this.distributorForm = {
      name: distributor.name,
      contactPerson: distributor.contactPerson,
      mobile: distributor.mobile,
      email: distributor.email ?? '',
      gstNumber: distributor.gstNumber,
      address: distributor.address,
      upiId: distributor.upiId ?? '',
      bankName: distributor.bankName ?? '',
      bankAccountNo: distributor.bankAccountNo ?? '',
      bankIfscCode: distributor.bankIfscCode ?? ''
    };
    this.view = 'distributor-form';
    this.message = '';
  }

  saveDistributor(): void {
    const request = this.editingDistributorId
      ? this.api.updateDistributor(this.editingDistributorId, this.distributorForm)
      : this.api.createDistributor(this.distributorForm);
    request.subscribe({
      next: distributor => {
        this.batchForm.distributorId = distributor.id;
        this.message = `${distributor.name} ${this.editingDistributorId ? 'updated' : 'added'}.`;
        this.editingDistributorId = undefined;
        this.view = 'distributors';
        this.reload();
      },
      error: error => this.fail(error)
    });
  }

  openAddCustomerDirect(): void {
    if (this.view !== 'customer-form') {
      this.viewHistory.push(this.view);
    }
    this.editingCustomerId = undefined;
    this.customerForm = {
      name: '',
      mobile: '',
      address: '',
      creditLimit: 0
    };
    this.view = 'customer-form';
    this.message = '';
  }

  editCustomerById(customerId: number): void {
    const customer = this.customers.find(c => c.id === customerId);
    if (customer) {
      this.editCustomer(customer);
    } else {
      this.message = 'Customer details not found in registry.';
    }
  }

  editCustomer(customer: Customer): void {
    if (this.view !== 'customer-form') {
      this.viewHistory.push(this.view);
    }
    this.editingCustomerId = customer.id;
    this.customerForm = {
      name: customer.name,
      mobile: customer.mobile || '',
      address: customer.address || '',
      creditLimit: customer.creditLimit || 0
    };
    this.view = 'customer-form';
    this.message = '';
  }

  saveCustomer(): void {
    if (!this.customerForm.name?.trim()) {
      this.message = 'Customer name is mandatory.';
      return;
    }
    this.busy = true;
    if (this.editingCustomerId) {
      this.api.updateCustomer(this.editingCustomerId, this.customerForm).subscribe({
        next: updated => {
          this.busy = false;
          this.customers = this.customers.map(c => c.id === updated.id ? updated : c);
          this.message = `Customer ${updated.name} updated successfully.`;
          this.goBack();
        },
        error: error => {
          this.busy = false;
          this.fail(error);
        }
      });
    } else {
      this.api.createCustomer(this.customerForm).subscribe({
        next: created => {
          this.busy = false;
          this.customers = [...this.customers, created];
          this.message = `Customer ${created.name} added successfully.`;
          this.goBack();
        },
        error: error => {
          this.busy = false;
          this.fail(error);
        }
      });
    }
  }
  cart: Array<{ medicine: Medicine; quantity: number; discount: number; stripQty?: number; unitQty?: number; selectedBatch?: any; batchId?: number | null; batchNo?: string }> = [];
  cartSearchQuery = '';
  cartSearchFocused = false;

  stockWatchTab: 'low-stock' | 'ordered' = 'low-stock';
  selectedOrderedDistributorId = 0;
  orderedPageIndex = 0;
  orderedPageSize = 5;

  getLowStockMedicines(): Medicine[] {
    return this.medicines.filter(m => m.availableQuantity <= (m.stockWatchQty ?? 10));
  }

  getLowStockItems(): Medicine[] {
    const lowStock = this.getLowStockMedicines().filter(m => m.orderStatus !== 'Ordered' && m.orderStatus !== 'Received');
    const manual = this.medicines.filter(m =>
      this.manuallyAddedToStockWatch.includes(m.id) &&
      !lowStock.some(ls => ls.id === m.id) &&
      m.orderStatus !== 'Ordered' &&
      m.orderStatus !== 'Received'
    );
    return [...lowStock, ...manual];
  }

  exportPurchaseOrderCSV(): void {
    const items = this.getLowStockItems();
    if (items.length === 0) {
      this.message = 'No low-stock items available to export for Purchase Order.';
      return;
    }

    let csvContent = 'Medicine Code,Medicine Name,Salt Composition,Manufacturer,Category,Available Qty,Reorder Qty,Suggested Order Qty\n';
    items.forEach(item => {
      const reorderQty = item.stockWatchQty ?? 10;
      const suggestedOrder = Math.max(reorderQty * 2 - item.availableQuantity, 10);
      const code = `"${(item.code || '').replace(/"/g, '""')}"`;
      const name = `"${(item.name || '').replace(/"/g, '""')}"`;
      const gen = `"${(item.genericName || '').replace(/"/g, '""')}"`;
      const mfg = `"${(item.manufacturer || '').replace(/"/g, '""')}"`;
      const cat = `"${(item.category || '').replace(/"/g, '""')}"`;
      csvContent += `${code},${name},${gen},${mfg},${cat},${item.availableQuantity},${reorderQty},${suggestedOrder}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Purchase_Order_${getLocalIsoDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.message = `Exported Purchase Order CSV with ${items.length} low-stock medicines!`;
  }

  addMasterToInventory(med: MasterMedicineView): void {
    if (!med) return;
    this.show('inventory-form');
    this.editingMedicineId = undefined;
    this.editingBatchId = undefined;
    this.medicineForm = {
      code: 'MED-' + Math.floor(1000 + Math.random() * 9000),
      name: med.name || '',
      genericName: med.saltComposition || '',
      category: med.category || 'General',
      manufacturer: med.manufacturerName || '',
      hsnCode: '300490',
      gstPercentage: 12,
      mrp: med.price || 1,
      sellingPrice: med.price || 1,
      discount: 0,
      prescriptionRequired: false,
      stockWatchQty: 10,
      sideEffects: med.sideEffects || ''
    };
    this.batchForm = {
      medicineId: 0,
      batchNo: 'B-' + Math.floor(1000 + Math.random() * 9000),
      expiryDate: getLocalIsoDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)),
      purchasePrice: med.price ? +(med.price * 0.8).toFixed(2) : 1,
      sellingPrice: med.price || 1,
      quantity: 50,
      availableQuantity: 50,
      distributorId: 0,
      billNo: '',
      billDate: '',
      dueDate: '',
      gstPercentage: 12,
      mrp: med.price || 1,
      discount: 0
    };
    this.message = `Pre-populated inventory form for "${med.name}". Complete batch details to save.`;
  }

  markBatchReturnedToDistributor(row: InventoryRow): void {
    if (!row || !row.batch) return;
    const confirmReturn = confirm(`Are you sure you want to mark ${row.batch.availableQuantity} units of ${row.medicine.name} (Batch: ${row.batch.batchNo}) as returned to distributor?`);
    if (!confirmReturn) return;

    this.busy = true;
    const qtyToReturn = row.batch.availableQuantity;
    const updatedBatchRequest = {
      batchNo: row.batch.batchNo,
      expiryDate: row.batch.expiryDate,
      purchasePrice: row.batch.purchasePrice,
      sellingPrice: row.batch.sellingPrice,
      mrp: row.batch.mrp || row.medicine.mrp,
      availableQuantity: 0
    };

    this.api.updateBatch(row.batch.id, updatedBatchRequest).subscribe({
      next: () => {
        this.busy = false;
        this.message = `Successfully marked ${qtyToReturn} units of ${row.medicine.name} as returned to distributor!`;
        this.reload();
      },
      error: err => {
        this.busy = false;
        this.fail(err);
      }
    });
  }

  getOrderedItems(): Medicine[] {
    return this.medicines.filter(m => m.orderStatus === 'Ordered' || m.orderStatus === 'Received');
  }

  getDistributorsWithOrders(): any[] {
    const dists: any[] = [];
    this.getOrderedItems().forEach(m => {
      if (m.orderedDistributorId && !dists.find(d => d.id === m.orderedDistributorId)) {
        dists.push({ id: m.orderedDistributorId, name: m.orderedDistributorName });
      }
    });
    return dists;
  }

  getFilteredOrderedItems(): Medicine[] {
    const items = this.getOrderedItems();
    const distId = Number(this.selectedOrderedDistributorId);
    if (distId === 0) {
      return items;
    }
    return items.filter(m => m.orderedDistributorId === distId);
  }

  getPaginatedOrderedItems(): Medicine[] {
    const items = this.getFilteredOrderedItems();
    const start = this.orderedPageIndex * this.orderedPageSize;
    return items.slice(start, start + this.orderedPageSize);
  }

  getOrderedTotalPages(): number {
    return Math.ceil(this.getFilteredOrderedItems().length / this.orderedPageSize) || 1;
  }

  getOrderedDisplayRange(): string {
    const total = this.getFilteredOrderedItems().length;
    if (total === 0) return '0 items';
    const start = this.orderedPageIndex * this.orderedPageSize + 1;
    const end = Math.min((this.orderedPageIndex + 1) * this.orderedPageSize, total);
    return `Showing ${start} - ${end} of ${total} items`;
  }

  onOrderedDistributorChange(): void {
    this.orderedPageIndex = 0;
  }

  orderDrafts: { [key: number]: { distributorId?: number; orderedDate?: string; orderedQuantity?: number } } = {};

  getOrderDraft(medicineId: number) {
    if (!this.orderDrafts[medicineId]) {
      const medicine = this.medicines.find(m => m.id === medicineId);
      const watchQty = medicine?.stockWatchQty ?? 10;
      this.orderDrafts[medicineId] = {
        orderedDate: getLocalIsoDate(),
        orderedQuantity: watchQty * 2 > 0 ? watchQty * 2 : 30
      };
    }
    if (!this.orderDrafts[medicineId].distributorId && this.distributors && this.distributors.length > 0) {
      this.orderDrafts[medicineId].distributorId = this.distributors[0].id;
    }
    return this.orderDrafts[medicineId];
  }

  updateOrderStatus(medicine: Medicine, status: string, distributorId?: number, orderedDate?: string, orderedQuantity?: number): void {
    if (!medicine.id) return;
    this.api.updateMedicineOrderStatus(medicine.id, status, orderedDate, distributorId, orderedQuantity).subscribe({
      next: updatedMed => {
        this.message = `Status updated for ${medicine.name} to ${status}`;
        if (status === 'Ordered') {
          this.manuallyAddedToStockWatch = this.manuallyAddedToStockWatch.filter(id => id !== medicine.id);
        }
        this.reload();
      },
      error: error => this.fail(error)
    });
  }

  receiveOrderedStock(medicine: Medicine): void {
    if (!medicine.id) return;
    this.api.updateMedicineOrderStatus(
      medicine.id,
      'Received',
      medicine.orderedDate,
      medicine.orderedDistributorId,
      medicine.orderedQuantity
    ).subscribe({
      next: () => {
        this.message = `Marked ${medicine.name} as Received.`;
        this.reload();
      },
      error: error => this.fail(error)
    });
  }

  getDistributorPricesForMedicine(medicine: Medicine): Array<{ distributor: string; price: number }> {
    if (!medicine.batches || medicine.batches.length === 0) return [];
    const map = new Map<string, number>();
    for (const batch of medicine.batches) {
      const distName = batch.distributorName;
      if (distName && distName !== 'Direct purchase') {
        const price = batch.purchasePrice;
        if (price !== undefined && price !== null) {
          if (!map.has(distName) || price < map.get(distName)!) {
            map.set(distName, price);
          }
        }
      }
    }
    return Array.from(map.entries())
      .map(([distributor, price]) => ({ distributor, price }))
      .sort((a, b) => a.price - b.price);
  }

  getBestPriceDistributor(medicine: Medicine): { distributor: string; price: number } | null {
    const prices = this.getDistributorPricesForMedicine(medicine);
    return prices.length > 0 ? prices[0] : null;
  }

  getDistributorPriceTooltip(medicine: Medicine): string {
    const prices = this.getDistributorPricesForMedicine(medicine);
    if (prices.length === 0) return 'No past purchase history';
    return 'Past Purchases:\n' + prices.map(p => `- ${p.distributor}: ₹${p.price.toFixed(2)}`).join('\n');
  }

  applyBestDistributor(medicineId: number, distributorName: string): void {
    const dist = this.distributors.find(d => d.name.toLowerCase() === distributorName.toLowerCase());
    if (dist) {
      const draft = this.getOrderDraft(medicineId);
      draft.distributorId = dist.id;
    }
  }

  selectedSwMasterMed: any = null;
  backendMasterSearchResults: any[] = [];

  onSwSearchInput(): void {
    const q = this.swSearchQuery.trim();
    if (!q) {
      this.backendMasterSearchResults = [];
      return;
    }
    this.api.searchMasterMedicines(q, 30).subscribe({
      next: masterMeds => {
        this.backendMasterSearchResults = masterMeds.map(m => ({
          id: -1,
          code: 'MASTER-REC',
          name: m.name,
          genericName: m.saltComposition || 'Standard Composition',
          manufacturer: m.manufacturerName || (m as any).manufacturer || '',
          category: m.category || 'General',
          hsnCode: '300490',
          gstPercentage: 12,
          mrp: m.price || 1,
          sellingPrice: m.price || 1,
          prescriptionRequired: false,
          stockWatchQty: 10,
          availableQuantity: 0,
          sideEffects: m.sideEffects || '',
          batches: []
        }));
      },
      error: () => { }
    });
  }

  getSwSearchSuggestions(): any[] {
    const q = this.swSearchQuery.trim().toLowerCase();
    if (!q) return [];

    if (this.csvCompositionMap.size === 0) {
      this.loadDefaultCompositionCsv();
    }

    const terms = q.split(/[\s,]+/).filter(t => t.trim().length > 0);
    if (terms.length === 0) return [];

    const matchesAllTerms = (fields: (string | undefined)[]) => {
      const text = fields.filter(Boolean).join(' ').toLowerCase();
      return terms.every(term => text.includes(term));
    };

    // 1. Inventory matches
    const inventoryMatches = this.medicines.filter(m =>
      matchesAllTerms([m.name, m.code, m.genericName, m.manufacturer, m.category, m.sideEffects])
    );

    // 2. Backend Master API matches
    const apiMasterMatches = this.backendMasterSearchResults.filter(m =>
      !inventoryMatches.some(inv => inv.name.toLowerCase() === m.name.toLowerCase())
    );

    // 3. Fallback CSV Master matches
    const masterMatches: any[] = [];
    for (const [medNameLower, data] of this.csvCompositionMap.entries()) {
      if (matchesAllTerms([medNameLower, data.composition, data.manufacturer, data.sideEffects])) {
        const alreadyInInventory = inventoryMatches.some(m => m.name.toLowerCase() === medNameLower);
        const alreadyInApi = apiMasterMatches.some(m => m.name.toLowerCase() === medNameLower);
        if (!alreadyInInventory && !alreadyInApi) {
          const formattedName = medNameLower.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          masterMatches.push({
            id: -1,
            code: 'MASTER-REC',
            name: formattedName,
            genericName: data.composition,
            manufacturer: data.manufacturer || 'Master List',
            category: 'General',
            hsnCode: '300490',
            gstPercentage: 12,
            mrp: 1,
            sellingPrice: 1,
            prescriptionRequired: false,
            stockWatchQty: 10,
            availableQuantity: 0,
            sideEffects: data.sideEffects || '',
            batches: []
          });
        }
      }
    }

    const combined = [...inventoryMatches, ...apiMasterMatches, ...masterMatches];
    return combined.sort((a, b) => {
      const scoreA = getMedicineSearchRelevanceScore(a, q);
      const scoreB = getMedicineSearchRelevanceScore(b, q);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.name.localeCompare(b.name);
    }).slice(0, 15);
  }

  selectSwSearchMedicine(medicine: any): void {
    if (medicine.id > 0) {
      this.swOrderForm.medicineId = medicine.id;
      this.selectedSwMasterMed = null;
    } else {
      this.swOrderForm.medicineId = -1;
      this.selectedSwMasterMed = medicine;
    }
    this.swSearchQuery = medicine.name;
    this.swSearchFocused = false;
  }

  onSwSearchBlur(): void {
    setTimeout(() => {
      this.swSearchFocused = false;
    }, 200);
  }

  addSearchMedicineToOrder(): void {
    const q = this.swSearchQuery.trim();
    if (!this.swOrderForm.medicineId && !q) {
      this.swMessage = 'Error: Please type, search, or select a medicine first.';
      return;
    }

    // A) Selected an existing inventory medicine
    if (this.swOrderForm.medicineId && this.swOrderForm.medicineId > 0) {
      const med = this.medicines.find(m => m.id === this.swOrderForm.medicineId);
      if (!med) {
        this.swMessage = 'Error: Selected medicine not found.';
        return;
      }
      if (med.orderStatus === 'Ordered' || med.orderStatus === 'Received') {
        this.swMessage = `Error: ${med.name} is already in the ordered list.`;
        return;
      }

      if (!this.manuallyAddedToStockWatch.includes(med.id)) {
        this.manuallyAddedToStockWatch.push(med.id);
      }

      const watchQty = med.stockWatchQty ?? 10;
      const qty = this.swOrderForm.orderedQuantity > 0 ? this.swOrderForm.orderedQuantity : (watchQty * 2 > 0 ? watchQty * 2 : 30);
      this.orderDrafts[med.id] = {
        orderedDate: getLocalIsoDate(),
        orderedQuantity: qty
      };

      this.swMessage = `${med.name} added to Order List. Fill in details and click Mark Ordered.`;
      this.swSearchQuery = '';
      this.swOrderForm.medicineId = null;
      this.selectedSwMasterMed = null;
      return;
    }

    // B) Selected a Master List item OR typed a name present in master list / new medicine
    let masterTarget = this.selectedSwMasterMed;
    if (!masterTarget && q) {
      const normQ = q.toLowerCase();
      const match = this.csvCompositionMap.get(normQ);
      if (match) {
        masterTarget = {
          name: q,
          genericName: match.composition,
          manufacturer: match.manufacturer || 'Master List',
          sideEffects: match.sideEffects || ''
        };
      } else {
        masterTarget = {
          name: q,
          genericName: '',
          manufacturer: 'Master List',
          sideEffects: ''
        };
      }
    }

    if (masterTarget) {
      const existingMed = this.medicines.find(m => m.name.toLowerCase() === masterTarget.name.toLowerCase());
      if (existingMed) {
        if (!this.manuallyAddedToStockWatch.includes(existingMed.id)) {
          this.manuallyAddedToStockWatch.push(existingMed.id);
        }
        const qty = this.swOrderForm.orderedQuantity > 0 ? this.swOrderForm.orderedQuantity : 30;
        this.orderDrafts[existingMed.id] = {
          orderedDate: getLocalIsoDate(),
          orderedQuantity: qty
        };
        this.swMessage = `${existingMed.name} added to Order List.`;
        this.swSearchQuery = '';
        this.swOrderForm.medicineId = null;
        this.selectedSwMasterMed = null;
        return;
      }

      this.busy = true;
      this.swMessage = '';

      const payload = {
        code: 'MED-' + masterTarget.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
        name: masterTarget.name,
        genericName: masterTarget.genericName || '',
        manufacturer: masterTarget.manufacturer || 'Master List',
        category: 'General',
        hsnCode: '300490',
        gstPercentage: 12.0,
        mrp: 1.0,
        sellingPrice: 1.0,
        prescriptionRequired: false,
        stockWatchQty: 10,
        sideEffects: masterTarget.sideEffects || ''
      };

      this.api.createMedicine(payload).subscribe({
        next: createdMed => {
          this.api.medicines().subscribe({
            next: meds => {
              this.medicines = meds;

              if (!this.manuallyAddedToStockWatch.includes(createdMed.id)) {
                this.manuallyAddedToStockWatch.push(createdMed.id);
              }

              const qty = this.swOrderForm.orderedQuantity > 0 ? this.swOrderForm.orderedQuantity : 30;
              this.orderDrafts[createdMed.id] = {
                orderedDate: getLocalIsoDate(),
                orderedQuantity: qty
              };

              this.swMessage = `${createdMed.name} (from Master List) added to Order List!`;
              this.swSearchQuery = '';
              this.swOrderForm.medicineId = null;
              this.selectedSwMasterMed = null;
            },
            error: error => this.fail(error),
            complete: () => this.busy = false
          });
        },
        error: error => {
          this.fail(error);
          this.busy = false;
        }
      });
    }
  }

  addNewMedicineToOrder(): void {
    if (!this.swNewForm.name.trim()) {
      this.swMessage = 'Error: Medicine Name is required.';
      return;
    }
    if (!this.swNewForm.manufacturer.trim()) {
      this.swMessage = 'Error: Manufacturer (Mfg) name is required.';
      return;
    }

    this.busy = true;
    this.swMessage = '';

    const payload = {
      code: 'MED-' + this.swNewForm.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
      name: this.swNewForm.name.trim(),
      genericName: this.swNewForm.genericName.trim(),
      manufacturer: this.swNewForm.manufacturer.trim(),
      category: 'General',
      hsnCode: '300490',
      gstPercentage: 12.0,
      mrp: 1.0,
      sellingPrice: 1.0,
      prescriptionRequired: false,
      stockWatchQty: 10
    };

    this.api.createMedicine(payload).subscribe({
      next: createdMed => {
        this.api.medicines().subscribe({
          next: meds => {
            this.medicines = meds;

            if (!this.manuallyAddedToStockWatch.includes(createdMed.id)) {
              this.manuallyAddedToStockWatch.push(createdMed.id);
            }

            this.orderDrafts[createdMed.id] = {
              orderedDate: getLocalIsoDate(),
              orderedQuantity: this.swNewForm.orderedQuantity > 0 ? this.swNewForm.orderedQuantity : 30
            };

            this.swMessage = `New medicine "${createdMed.name}" created and added to drafts below. Fill in details and click Mark Ordered.`;
            this.swNewForm = { name: '', genericName: '', manufacturer: '', orderedQuantity: 30 };
            this.busy = false;
          },
          error: error => {
            this.busy = false;
            this.fail(error);
          }
        });
      },
      error: error => {
        this.busy = false;
        this.swMessage = 'Error: ' + (error.error?.message ?? 'Failed to create new medicine.');
      }
    });
  }

  getUnexpiredStock(medicine: Medicine): number {
    const packSize = this.getPackSize(medicine);
    return medicine.batches
      .filter(b => this.daysUntil(b.expiryDate) >= 0)
      .reduce((sum, b) => sum + (b.availableQuantity * packSize) + (b.looseUnitsAvailable || 0), 0);
  }

  getUnexpiredBatches(medicine: Medicine): Batch[] {
    return medicine.batches
      .filter(b => this.daysUntil(b.expiryDate) >= 0 && (b.availableQuantity > 0 || (b.looseUnitsAvailable || 0) > 0))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  }

  getBatchTotalUnits(batch: Batch | any, medicine?: Medicine | any): number {
    if (!batch) return 0;
    const med = medicine || this.medicines.find(m => m.id === batch.medicineId);
    const packSize = this.getPackSize(med);
    return (batch.availableQuantity * packSize) + (batch.looseUnitsAvailable || 0);
  }

  getBatchStockDisplay(batch: Batch | any, medicine?: Medicine | any): string {
    if (!batch) return '0';
    const med = medicine || this.medicines.find(m => m.id === batch.medicineId);
    const packSize = this.getPackSize(med);
    if (packSize <= 1 || !this.isLooseSellable(med)) {
      return `${batch.availableQuantity}`;
    }
    const totalUnits = this.getBatchTotalUnits(batch, med);
    const strips = totalUnits / packSize;
    return strips % 1 === 0 ? `${strips}` : strips.toFixed(1);
  }

  getBatchStockFullDisplay(batch: Batch | any, medicine?: Medicine | any): string {
    if (!batch) return '0';
    const med = medicine || this.medicines.find(m => m.id === batch.medicineId);
    const packSize = this.getPackSize(med);
    const unitLabel = this.getSellUnitLabel(med, batch.availableQuantity);
    if (packSize <= 1 || !this.isLooseSellable(med)) {
      return `${batch.availableQuantity} ${unitLabel}`;
    }
    const loose = batch.looseUnitsAvailable || 0;
    const whole = batch.availableQuantity;
    const totalUnits = (whole * packSize) + loose;
    if (loose > 0) {
      return `${whole} ${unitLabel} + ${loose} Tabs (${totalUnits} units)`;
    }
    return `${whole} ${unitLabel} (${totalUnits} units)`;
  }

  getMedicineStockDisplay(medicine: Medicine | any): string {
    if (!medicine) return '0';
    const packSize = this.getPackSize(medicine);
    const totalUnits = this.getUnexpiredStock(medicine);
    if (packSize <= 1 || !this.isLooseSellable(medicine)) {
      return `${totalUnits}`;
    }
    const strips = totalUnits / packSize;
    return strips % 1 === 0 ? `${strips}` : strips.toFixed(1);
  }

  getItemStockUnits(item: any): number {
    if (!item || !item.medicine) return 0;
    if (item.selectedBatch) {
      return this.getBatchTotalUnits(item.selectedBatch, item.medicine);
    }
    return this.getUnexpiredStock(item.medicine);
  }

  getItemStockDisplay(item: any): string {
    if (!item || !item.medicine) return '0';
    if (item.selectedBatch) {
      return this.getBatchStockDisplay(item.selectedBatch, item.medicine);
    }
    return this.getMedicineStockDisplay(item.medicine);
  }

  getItemGstAmount(item: any): number {
    const itemGross = item.medicine.mrp * item.quantity;
    const itemDiscount = item.discount * item.quantity;
    const itemNetBeforeFlat = itemGross - itemDiscount;
    const cartTotalBeforeFlat = this.cart.reduce((sum, i) => sum + ((i.medicine.mrp - i.discount) * i.quantity), 0);
    const flatDiscount = this.saleForm.discountAmount || 0;
    const ratio = cartTotalBeforeFlat > 0 ? Math.max(0, cartTotalBeforeFlat - flatDiscount) / cartTotalBeforeFlat : 0;
    const itemNet = itemNetBeforeFlat * ratio;
    return Number((itemNet - (itemNet / (1 + item.medicine.gstPercentage / 100))).toFixed(2));
  }

  /**
   * Industry standard form factor classification:
   * General pharmacy items (Amoxicillin, Ibuprofen, Paracetamol, Amlodipine etc.) default to Tablets/Capsules (Splittable).
   * ONLY explicit Liquids (syrups, suspensions, drops), Injections/Syringes (vials, ampoules),
   * Topical (creams, ointments, gels), Sachets, and Devices are whole non-splittable units.
   */
  isLooseSellable(medicine: Medicine | any): boolean {
    if (!medicine) return true;
    const cat = (medicine.category || '').toLowerCase();
    const name = (medicine.name || medicine.medicineName || '').toLowerCase();
    const pack = (medicine.pack || '').toLowerCase();
    const combined = ` ${name} ${cat} ${pack} `;

    // Explicit non-splittable keywords with word boundaries to prevent false substring matches (e.g., 'ml' in 'amlodipine' or 'amp' in 'ampicillin')
    const nonSplittableRegex = /\b(syrups?|syp|suspensions?|susp|liquids?|solutions?|drops?|eye\s*drops?|ear\s*drops?|injections?|inj|vials?|ampoules?|amp|syringes?|\d+\s*ml|creams?|crm|ointments?|oint|gels?|lotions?|tubes?|sprays?|inhalers?|bottles?|bot|sachets?|powders?|pwd|devices?|kits?|tins?|masks?|gloves?|tapes?|strips?\s*glucometer)\b/i;

    if (nonSplittableRegex.test(combined)) {
      // Check if it's explicitly a tablet or capsule despite other words (e.g., "Gelusil Tablet" or "Powder Tablet")
      if (/\b(tablets?|tabs?|capsules?|caps?)\b/i.test(combined)) {
        return true;
      }
      return false;
    }

    // Default for all general pharma products: Tablets / Capsules (Splittable)
    return true;
  }

  /** Returns human-readable unit label (Bottle, Tube, Sachet, Pcs, Strip) */
  getSellUnitLabel(medicine: Medicine | any, quantity = 1): string {
    if (!medicine) return quantity === 1 ? 'Strip' : 'Strips';
    const cat = (medicine.category || '').toLowerCase();
    const name = (medicine.name || medicine.medicineName || '').toLowerCase();
    const pack = (medicine.pack || '').toLowerCase();
    const combined = ` ${name} ${cat} ${pack} `;

    let base = 'Strip';
    if (/\b(syrup|syp|suspension|susp|liquid|solution|drops?|eye\s*drop|ear\s*drop|bottle|bot)\b/i.test(combined)) {
      base = 'Bottle';
    } else if (/\b(cream|crm|ointment|oint|gel|lotion|tube)\b/i.test(combined) && !/\b(tabs?|tablets?|caps?|capsules?)\b/i.test(combined)) {
      base = 'Tube';
    } else if (/\b(sachet|sachets|powder|pwd)\b/i.test(combined) && !/\b(tabs?|tablets?|caps?|capsules?)\b/i.test(combined)) {
      base = 'Sachet';
    } else if (/\b(inj|injection|vial|ampoule|amp|syringe|\d+\s*ml|device|kit|mask|glove)\b/i.test(combined) && !/\b(tabs?|tablets?|caps?|capsules?)\b/i.test(combined)) {
      base = 'Pcs';
    }

    if (base === 'Pcs') return 'Pcs';
    if (quantity === 1) return base;
    return `${base}s`;
  }

  /** Returns human-readable quantitative pack detail for UI and PDF display (e.g., "10 Tabs/Strip", "100 ml Bottle", "3 ml Syringe") */
  getMedicinePack(item: any): string {
    if (!item) return '10 Tabs/Strip';
    const medicine = item.medicine || item;
    const cat = (medicine.category || item.category || '').trim();

    // If category already contains digits and quantitative words (e.g. "10 Tabs/Strip", "100 ml Bottle", "15 Caps/Strip", "30g Tube", "21.8g Sachet")
    if (/\d+/.test(cat) && !/^(antibiotic|analgesic|otc|wellness|cardiology|diabetes|pulmonology|gastroenterology|antihistamine)$/i.test(cat)) {
      return cat;
    }

    const unitLabel = this.getSellUnitLabel(medicine, 1);
    const name = (medicine.name || medicine.medicineName || '').toLowerCase();

    if (unitLabel === 'Bottle') return '100 ml Bottle';
    if (unitLabel === 'Tube') return '30 g Tube';
    if (unitLabel === 'Sachet') return '1 Sachet';
    if (unitLabel === 'Pcs') {
      if (/\b(\d+\s*ml|syringe)\b/i.test(name)) return '3 ml Syringe';
      if (/\b(inj|vial)\b/i.test(name)) return '1 Vial';
      return '1 Pcs';
    }

    const packSize = this.getPackSize(medicine);
    return `${packSize} Tabs/Strip`;
  }

  getPackSize(medicine: Medicine | any): number {
    if (!medicine) return 10;
    // Non-splittable products (syrups, syringes, vials, ointments etc.) always have packSize = 1
    if (!this.isLooseSellable(medicine)) return 1;

    const packStr = `${medicine.category || ''} ${medicine.pack || ''} ${medicine.name || medicine.medicineName || ''}`;

    // 1. Explicit multiplier like "10x10", "1x15", "2 x 14", "10*10"
    const multMatch = packStr.match(/\d+\s*[x*]\s*(\d+)/i);
    if (multMatch && multMatch[1]) {
      const parsed = parseInt(multMatch[1], 10);
      if (parsed > 0 && parsed <= 100) return parsed;
    }

    // 2. Explicit pack size mentions like "15 Tabs", "10's", "14 Caps", "10 Tablets/Strip", "Pack of 15", "10T", "10S"
    const explicitMatch = packStr.match(/\b(\d+)\s*(?:tabs?|tablets?|caps?|capsules?|'s|s\b|\/strip|per\s*strip)/i);
    if (explicitMatch && explicitMatch[1]) {
      const parsed = parseInt(explicitMatch[1], 10);
      if (parsed > 0 && parsed <= 100) return parsed;
    }

    // 3. Category with digits like "15 Caps/Strip" or "10 Tabs/Strip"
    const cat = (medicine.category || '').trim();
    const catMatch = cat.match(/^(\d+)\s*(?:tabs?|caps?|tablets?|capsules?)/i);
    if (catMatch && catMatch[1]) {
      const parsed = parseInt(catMatch[1], 10);
      if (parsed > 0 && parsed <= 100) return parsed;
    }

    // Default for tablets/capsules in Indian pharmacy software
    return 10;
  }

  getUnitMrp(medicine: Medicine): number {
    const packSize = this.getPackSize(medicine);
    const mrp = medicine.mrp || 0;
    return packSize > 0 ? Number((mrp / packSize).toFixed(2)) : mrp;
  }

  getUnitDiscount(item: any): number {
    const packSize = this.getPackSize(item.medicine);
    const disc = item.discount || 0;
    return packSize > 0 ? Number((disc / packSize).toFixed(2)) : disc;
  }

  getItemDiscountPercent(item: any): number {
    const mrp = item.medicine.mrp || 0;
    if (mrp <= 0) return 0;
    return Number(((item.discount / mrp) * 100).toFixed(2));
  }

  getPackSellingPrice(item: any): number {
    return (item.medicine.mrp || 0) - (item.discount || 0);
  }

  getUnitSellingPrice(item: any): number {
    const packSize = this.getPackSize(item.medicine);
    const packPrice = this.getPackSellingPrice(item);
    return packSize > 0 ? Number((packPrice / packSize).toFixed(2)) : packPrice;
  }

  getTotalLooseUnits(item: any): number {
    if (!item || !item.medicine) return 0;
    const packSize = this.getPackSize(item.medicine);
    const strips = Math.max(0, item.stripQty !== undefined ? item.stripQty : item.quantity || 0);
    const units = Math.max(0, item.unitQty || 0);
    return (strips * packSize) + units;
  }

  onDualQtyChange(item: any): void {
    if (!item || !item.medicine) return;
    const packSize = this.getPackSize(item.medicine);
    // getUnexpiredStock now returns total individual units (e.g. 86 for 8 strips + 6 loose from 10-pack)
    const maxUnits = this.getUnexpiredStock(item.medicine);

    if (item.stripQty === undefined || item.stripQty < 0) item.stripQty = 0;
    if (item.unitQty === undefined || item.unitQty < 0) item.unitQty = 0;

    let totalUnits = (item.stripQty * packSize) + item.unitQty;
    if (totalUnits > maxUnits) {
      totalUnits = maxUnits;
      item.stripQty = Math.floor(totalUnits / packSize);
      item.unitQty = totalUnits % packSize;
      this.message = `Quantity capped at total available stock (${maxUnits} units) for ${item.medicine.name}.`;
    }

    item.quantity = Number((totalUnits / packSize).toFixed(4));
    this.cart = [...this.cart];
  }

  onQtyChange(item: any): void {
    this.onDualQtyChange(item);
  }

  addToCart(medicine: Medicine, quantity = 1, targetBatch?: any): void {
    this.lastSale = undefined;
    const unexpiredStockUnits = this.getUnexpiredStock(medicine);
    if (unexpiredStockUnits <= 0) {
      this.message = `Cannot add ${medicine.name} to cart. Out of stock or expired!`;
      return;
    }
    const unexpiredBatches = this.getUnexpiredBatches(medicine);
    const selBatch = targetBatch || (unexpiredBatches.length > 0 ? unexpiredBatches[0] : null);

    const packSize = this.getPackSize(medicine);
    const unexpiredStockStrips = Math.floor(unexpiredStockUnits / packSize);
    const existing = this.cart.find(item => item.medicine.id === medicine.id);
    if (existing) {
      if (selBatch) {
        existing.selectedBatch = selBatch;
        existing.batchId = selBatch.id;
        existing.batchNo = selBatch.batchNo;
      }
      const currentUnits = this.getTotalLooseUnits(existing);
      if (currentUnits + quantity * packSize > unexpiredStockUnits) {
        existing.stripQty = unexpiredStockStrips;
        existing.unitQty = unexpiredStockUnits % packSize;
        this.onDualQtyChange(existing);
        this.message = `Quantity capped at available unexpired stock (${unexpiredStockUnits} units) for ${medicine.name}.`;
      } else {
        existing.stripQty = (existing.stripQty || 0) + quantity;
        this.onDualQtyChange(existing);
        this.message = `Updated quantity for ${medicine.name} in cart.`;
      }
      this.cart = [...this.cart];
    } else {
      const initialQty = Math.min(quantity, unexpiredStockStrips);
      const mrp = (selBatch && selBatch.mrp) ? selBatch.mrp : (medicine.mrp || 0);
      const sellingPrice = (selBatch && selBatch.sellingPrice) ? selBatch.sellingPrice : (medicine.sellingPrice || 0);
      const builtInDisc = mrp > 0 ? Math.max(0, mrp - sellingPrice) : 0;
      this.cart = [...this.cart, {
        medicine,
        selectedBatch: selBatch,
        batchId: selBatch?.id || null,
        batchNo: selBatch?.batchNo || '',
        quantity: initialQty,
        stripQty: initialQty,
        unitQty: 0,
        discount: Number(builtInDisc.toFixed(2))
      }];
      this.message = `Added ${medicine.name} (Batch: ${selBatch?.batchNo || 'Default'}) to cart.`;
    }
  }

  onCartBatchChange(item: any): void {
    if (item && item.selectedBatch) {
      item.batchId = item.selectedBatch.id;
      item.batchNo = item.selectedBatch.batchNo;
      if (item.selectedBatch.mrp) {
        const mrp = item.selectedBatch.mrp;
        const sellingPrice = item.selectedBatch.sellingPrice || item.medicine.sellingPrice || mrp;
        item.discount = Number(Math.max(0, mrp - sellingPrice).toFixed(2));
      }
    }
  }

  removeFromCart(index: number): void {
    this.cart.splice(index, 1);
    this.cart = [...this.cart];
    this.message = 'Item removed from cart.';
  }

  getCartSearchSuggestions(): Medicine[] {
    const q = this.cartSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = this.medicines.filter(m =>
      (m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        (m.genericName && m.genericName.toLowerCase().includes(q))) &&
      this.getUnexpiredStock(m) > 0
    );

    return matches.sort((a, b) => {
      const scoreA = getMedicineSearchRelevanceScore(a, q);
      const scoreB = getMedicineSearchRelevanceScore(b, q);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.name.localeCompare(b.name);
    }).slice(0, 10);
  }

  addSuggestedMedicine(medicine: Medicine): void {
    this.addToCart(medicine, 1);
    this.cartSearchQuery = '';
    this.cartSearchFocused = false;
  }

  onCartSearchBlur(): void {
    setTimeout(() => {
      this.cartSearchFocused = false;
    }, 200);
  }

  onDiscountChange(item: any): void {
    if (item.discount === null || item.discount === undefined) {
      item.discount = 0;
    }
    const mrp = item.medicine.mrp || 0;
    const sellingPrice = item.medicine.sellingPrice || 0;
    const minDisc = mrp > 0 ? Math.max(0, mrp - sellingPrice) : 0;
    if (item.discount < minDisc) {
      item.discount = minDisc;
    }
    if (item.discount > mrp) {
      item.discount = mrp;
    }
  }

  setCustomerType(type: 'regular' | 'credit-existing' | 'credit-new'): void {
    this.customerType = type;
    this.message = '';
    this.upfrontPaymentAmount = 0;

    // Set default payment mode based on type
    if (type === 'regular') {
      this.saleForm.paymentMode = 'CASH';
      this.selectedCreditCustomer = undefined;
      this.creditCustomerSearchQuery = '';
    } else {
      this.saleForm.paymentMode = 'CREDIT';
      // Default credit due date to 30 days from now
      const thirtyDays = new Date();
      thirtyDays.setDate(thirtyDays.getDate() + 30);
      this.saleForm.creditDueDate = getLocalIsoDate(thirtyDays);
    }
  }

  getCreditCustomerSuggestions(): Customer[] {
    const q = this.creditCustomerSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return this.customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.mobile && c.mobile.includes(q))
    ).slice(0, 8);
  }

  selectCreditCustomer(customer: Customer): void {
    this.selectedCreditCustomer = customer;
    this.saleForm.customerId = customer.id;
    this.creditCustomerSearchQuery = customer.name;
    this.creditSearchFocused = false;
  }

  clearSelectedCreditCustomer(): void {
    this.selectedCreditCustomer = undefined;
    this.saleForm.customerId = 0;
    this.creditCustomerSearchQuery = '';
  }

  onCreditSearchBlur(): void {
    setTimeout(() => {
      this.creditSearchFocused = false;
    }, 200);
  }

  get cartGrossTotal(): number {
    return this.cart.reduce((sum, item) => sum + (item.medicine.mrp * item.quantity), 0);
  }

  get cartDiscountTotal(): number {
    const itemDiscounts = this.cart.reduce((sum, item) => sum + (item.discount * item.quantity), 0);
    return Number((itemDiscounts + (this.saleForm.discountAmount || 0)).toFixed(2));
  }

  get cartGstTotal(): number {
    return this.cart.reduce((sum, item) => sum + this.getItemGstAmount(item), 0);
  }

  get cartNetTotal(): number {
    const gross = this.cartGrossTotal;
    const discount = this.cartDiscountTotal;
    const net = gross - discount;
    return Math.round(net);
  }

  viewCustomerDetails(customer: Customer): void {
    this.selectedReportCustomer = customer;
    this.busy = true;
    this.expandedTxnId = null;
    this.ledgerDatePreset = '';
    this.ledgerStartDate = '';
    this.ledgerEndDate = '';
    this.ledgerStatusFilter = '';
    this.api.getCustomerCredits(customer.id).subscribe({
      next: data => {
        this.customerCreditHistory = data;
        this.busy = false;
      },
      error: error => this.fail(error)
    });
  }

  toggleTxnPayments(txnId: number): void {
    this.expandedTxnId = this.expandedTxnId === txnId ? null : txnId;
  }

  viewInvoiceDetails(billNo: string): void {
    this.busy = true;
    this.api.getSaleByBillNo(billNo).subscribe({
      next: sale => {
        this.viewingInvoice = sale;
        this.busy = false;
      },
      error: error => this.fail(error)
    });
  }

  openBillByNumber(billNo?: string, distributorName?: string): void {
    if (!billNo || billNo === 'N/A') return;
    this.busy = true;
    this.api.getSaleByBillNo(billNo).subscribe({
      next: (sale: Sale) => {
        if (sale && sale.billNo) {
          this.viewingInvoice = sale;
          this.busy = false;
        } else {
          this.fetchAndShowDistributorBill(billNo, distributorName);
        }
      },
      error: () => {
        this.fetchAndShowDistributorBill(billNo, distributorName);
      }
    });
  }

  private fetchAndShowDistributorBill(billNo: string, distributorName?: string): void {
    const dist = distributorName ? this.distributors.find((d: Distributor) => d.name.trim().toLowerCase() === distributorName.trim().toLowerCase()) : undefined;
    if (dist) {
      this.selectedDistributor = dist;
      this.api.distributorBills(dist.id).subscribe({
        next: (bills: DistributorBillView[]) => {
          this.busy = false;
          this.distributorBillsList = bills;
          const targetBill = bills.find((b: DistributorBillView) => b.billNo.toLowerCase() === billNo.toLowerCase());
          if (targetBill) {
            this.viewDistributorBill(targetBill);
          } else {
            this.message = `Bill ${billNo} not found for ${dist.name}.`;
          }
        },
        error: (err: any) => {
          this.busy = false;
          this.fail(err);
        }
      });
    } else {
      this.api.allDistributorBills().subscribe({
        next: (bills: DistributorBillView[]) => {
          this.busy = false;
          const targetBill = bills.find((b: DistributorBillView) => b.billNo.toLowerCase() === billNo.toLowerCase());
          if (targetBill) {
            if (targetBill.distributorName) {
              const matchedDist = this.distributors.find((d: Distributor) => d.name.trim().toLowerCase() === targetBill.distributorName.trim().toLowerCase());
              if (matchedDist) {
                this.selectedDistributor = matchedDist;
              }
            }
            this.viewDistributorBill(targetBill);
          } else {
            this.message = `Bill ${billNo} could not be found.`;
          }
        },
        error: (err: any) => {
          this.busy = false;
          this.fail(err);
        }
      });
    }
  }

  closeInvoiceDetails(): void {
    this.viewingInvoice = undefined;
  }

  closeCustomerDetails(): void {
    this.selectedReportCustomer = undefined;
    this.customerCreditHistory = [];
    this.expandedTxnId = null;
  }

  get filteredCustomers(): Customer[] {
    const q = this.customerSearchQuery.trim().toLowerCase();
    const walkIn: Customer = {
      id: 0,
      name: 'POS Walk-in',
      mobile: '-',
      address: 'Counter Sales',
      creditLimit: 0,
      outstanding: 0
    };

    let list = [...this.customers];

    const includeWalkIn = !q ||
      walkIn.name.toLowerCase().includes(q) ||
      walkIn.address.toLowerCase().includes(q);

    if (includeWalkIn) {
      list.push(walkIn);
    }

    if (q) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.mobile && c.mobile.includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q)) ||
        (c.creditLimit !== undefined && c.creditLimit !== null && c.creditLimit.toString().includes(q))
      );
    }

    return list.sort((a, b) => {
      if (b.outstanding !== a.outstanding) {
        return b.outstanding - a.outstanding;
      }
      return a.name.localeCompare(b.name);
    });
  }

  bill(): void {
    console.log('[BILL] bill() called, cart length:', this.cart.length, 'customerType:', this.customerType, 'busy:', this.busy);
    if (this.cart.length === 0) {
      this.message = 'Cart is empty. Please add medicines first.';
      return;
    }

    if (this.customerType === 'regular') {
      console.log('[BILL] Regular customer flow, name:', this.regularCustomerName);
      this.findOrCreateRegularCustomer(this.regularCustomerName, this.regularCustomerMobile, (customerId) => {
        console.log('[BILL] findOrCreateRegularCustomer callback, customerId:', customerId);
        this.saleForm.customerId = customerId;
        this.executeBillPosting();
      });
    } else if (this.customerType === 'credit-existing') {
      if (!this.selectedCreditCustomer) {
        this.message = 'Please search and select an existing credit customer.';
        return;
      }
      this.saleForm.customerId = this.selectedCreditCustomer.id;
      this.saleForm.paymentMode = 'CREDIT';
      this.saleForm.customerAge = ''; // Age is already collected or not needed
      this.executeBillPosting();
    } else if (this.customerType === 'credit-new') {
      if (!this.customerForm.name.trim()) {
        this.message = 'Please enter the name for the new credit customer.';
        return;
      }
      if (!this.customerForm.mobile.trim()) {
        this.message = 'Mobile number is mandatory for new credit customers.';
        return;
      }
      if (!this.saleForm.customerAge.trim()) {
        this.message = 'Age is mandatory for new credit customers.';
        return;
      }

      this.busy = true;
      this.api.createCustomer(this.customerForm).subscribe({
        next: customer => {
          this.customers = [...this.customers, customer];
          this.saleForm.customerId = customer.id;
          this.saleForm.paymentMode = 'CREDIT';
          this.message = `Customer ${customer.name} registered. Posting bill...`;
          this.executeBillPosting();
        },
        error: error => this.fail(error)
      });
    }
  }

  private findOrCreateRegularCustomer(name: string, mobile: string, callback: (customerId: number) => void): void {
    const cleanedName = name.trim();
    const cleanedMobile = mobile.trim();

    // If both name is empty/walk-in AND mobile is empty, it's a true walk-in without customer tracking
    if ((!cleanedName || cleanedName.toLowerCase() === 'walk-in') && !cleanedMobile) {
      callback(0);
      return;
    }

    // Determine target name: if empty/walk-in but has a mobile number, use a default name referencing the phone
    const targetName = (!cleanedName || cleanedName.toLowerCase() === 'walk-in') ? `Customer-${cleanedMobile}` : cleanedName;

    // Search existing:
    // First try finding by mobile if mobile is provided
    let existing: Customer | undefined;
    if (cleanedMobile) {
      existing = this.customers.find(c => c.mobile && c.mobile.replace(/[^0-9]/g, '') === cleanedMobile.replace(/[^0-9]/g, ''));
    }
    // If not found by mobile, search by name case-insensitively
    if (!existing) {
      existing = this.customers.find(c => c.name.toLowerCase() === targetName.toLowerCase());
    }

    if (existing) {
      // If we found them, check if their mobile number or name differs from what was typed/selected
      const needsMobileUpdate = cleanedMobile && existing.mobile !== cleanedMobile;
      const needsNameUpdate = cleanedName && cleanedName.toLowerCase() !== 'walk-in' && existing.name !== cleanedName;

      if (needsMobileUpdate || needsNameUpdate) {
        this.busy = true;
        const payload = {
          name: needsNameUpdate ? cleanedName : existing.name,
          mobile: cleanedMobile ? cleanedMobile : (existing.mobile || ''),
          address: existing.address || 'Counter Sales',
          creditLimit: existing.creditLimit || 0
        };
        this.api.createCustomer(payload).subscribe({
          next: customer => {
            this.busy = false;
            // update local list cache
            this.customers = this.customers.map(c => c.id === customer.id ? customer : c);
            callback(customer.id);
          },
          error: error => {
            this.fail(error);
          }
        });
      } else {
        callback(existing.id);
      }
    } else {
      // Create new customer
      this.busy = true;
      const payload = {
        name: targetName,
        mobile: cleanedMobile,
        address: 'Counter Sales',
        creditLimit: 0
      };
      this.api.createCustomer(payload).subscribe({
        next: customer => {
          this.busy = false;
          this.customers = [...this.customers, customer];
          callback(customer.id);
        },
        error: error => {
          this.fail(error);
        }
      });
    }
  }

  private executeBillPosting(): void {
    console.log('[BILL] executeBillPosting() called');
    // Per-item discounts (MRP - sellingPrice) are already reflected in batch.sellingPrice on the backend.
    // Only send additional manual discounts here to avoid double-counting.
    const totalDiscount = this.saleForm.discountAmount || 0;
    console.log('[BILL] totalDiscount (manual only):', totalDiscount);

    const itemsPayload = this.cart.map(item => {
      const totalUnits = this.getTotalLooseUnits(item);
      const packSize = this.getPackSize(item.medicine);
      // Send total units (e.g. 4 for 4 tablets, 16 for 1 strip + 6 tabs)
      // and packSize so backend can convert to fractional packs correctly
      const qtyUnits = totalUnits > 0 ? totalUnits : ((item.quantity || 1) * packSize);
      return {
        medicineId: item.medicine.id,
        quantity: qtyUnits,
        packSize: packSize,
        batchId: item.batchId || item.selectedBatch?.id || null,
        batchNo: item.batchNo || item.selectedBatch?.batchNo || null
      };
    });

    const payload = {
      customerId: this.saleForm.customerId || null,
      customerAge: this.saleForm.customerAge || null,
      doctorName: this.saleForm.doctorName || null,
      paymentMode: this.saleForm.paymentMode,
      discountAmount: totalDiscount,
      creditDueDate: this.saleForm.creditDueDate || null,
      items: itemsPayload
    };
    console.log('[BILL] Payload:', JSON.stringify(payload));

    this.busy = true;
    this.api.createSale(payload).subscribe({
      next: sale => {
        console.log('[BILL] Sale created successfully:', sale.billNo);
        this.lastSale = sale;
        this.message = `${sale.billNo} posted successfully. Stock updated.`;
        this.cart = [];

        // Auto-send WhatsApp Invoice / E-Bill (Scenario 1)
        if (sale.customerMobile) {
          this.sendWhatsAppInvoice(sale);
        }

        const upfrontAmount = this.upfrontPaymentAmount;
        if (this.saleForm.paymentMode === 'CREDIT' && upfrontAmount > 0) {
          this.api.credits().subscribe({
            next: creditsList => {
              const matchedCredit = creditsList.find(c => c.billNo === sale.billNo);
              if (matchedCredit) {
                this.api.payCredit(matchedCredit.id, upfrontAmount).subscribe({
                  next: () => {
                    this.message = `${sale.billNo} posted. Upfront payment of ₹${upfrontAmount} recorded.`;
                    this.busy = false;
                    this.resetSaleFormAfterPost();
                    this.reload();
                  },
                  error: error => {
                    this.busy = false;
                    this.resetSaleFormAfterPost();
                    this.fail(error);
                  }
                });
              } else {
                this.busy = false;
                this.resetSaleFormAfterPost();
                this.reload();
              }
            },
            error: () => {
              this.busy = false;
              this.resetSaleFormAfterPost();
              this.reload();
            }
          });
        } else {
          this.busy = false;
          this.resetSaleFormAfterPost();
          this.reload();
        }
      },
      error: error => {
        console.error('[BILL] createSale ERROR:', error.status, error.error);
        this.fail(error);
      }
    });
  }

  private resetSaleFormAfterPost(): void {
    this.saleForm = {
      customerId: 0,
      customerAge: '',
      doctorName: '',
      paymentMode: 'CASH' as PaymentMode,
      discountAmount: 0,
      creditDueDate: '',
      items: [{ medicineId: 0, quantity: 1 }]
    };
    this.customerForm = {
      name: '',
      mobile: '',
      address: '',
      creditLimit: 0
    };
    this.selectedCreditCustomer = undefined;
    this.creditCustomerSearchQuery = '';
    this.regularCustomerName = 'Walk-in';
    this.regularCustomerMobile = '';
    this.upfrontPaymentAmount = 0;
  }

  pay(credit: Credit): void {
    const rawAmount = this.paymentAmounts[credit.id];
    const amount = (rawAmount !== undefined && rawAmount !== null && (rawAmount as any) !== '')
      ? Number(rawAmount)
      : credit.dueAmount;

    if (isNaN(amount) || amount <= 0) {
      this.message = 'Error: Please enter a valid positive payment amount.';
      return;
    }

    if (amount > credit.dueAmount) {
      this.message = `Error: Payment of ₹${amount} exceeds the remaining due amount of ₹${credit.dueAmount}.`;
      return;
    }

    if (this.confirmingCreditId !== credit.id) {
      this.confirmingCreditId = credit.id;
      // Reset after 4 seconds if they don't confirm
      setTimeout(() => {
        if (this.confirmingCreditId === credit.id) {
          this.confirmingCreditId = null;
        }
      }, 4000);
      return;
    }

    // Confirmed on second click!
    this.confirmingCreditId = null;
    const mode = this.creditPaymentModes[credit.id] ?? 'CASH';
    const ref = this.creditPaymentReferences[credit.id] ?? '';

    this.api.payCredit(credit.id, amount, mode, ref).subscribe({
      next: updated => {
        this.credits = updated.status === 'SETTLED'
          ? this.credits.filter(item => item.id !== updated.id)
          : this.credits.map(item => item.id === updated.id ? updated : item);
        this.message = `Payment of ₹${amount} posted against ${credit.billNo}.`;
        this.paymentAmounts[credit.id] = 0;
        this.creditPaymentModes[credit.id] = 'CASH';
        this.creditPaymentReferences[credit.id] = '';
        this.reload();
      },
      error: error => this.fail(error)
    });
  }

  onCreditCustomerSelect(): void {
    const openBills = this.getOpenBillsForSelectedCustomer();
    if (openBills.length > 0) {
      this.customerCreditPaymentForm.creditId = openBills[0].id;
      this.customerCreditPaymentForm.amount = openBills[0].dueAmount;
    } else {
      this.customerCreditPaymentForm.creditId = 0;
      this.customerCreditPaymentForm.amount = 0;
    }
  }

  getOpenBillsForSelectedCustomer(): Credit[] {
    const cid = Number(this.customerCreditPaymentForm.customerId);
    if (!cid) return [];
    const group = this.groupedCredits.find(g => g.customerId === cid);
    return group ? group.bills : [];
  }

  onCreditBillSelect(): void {
    const creditId = Number(this.customerCreditPaymentForm.creditId);
    if (!creditId) return;
    const credit = this.credits.find(c => c.id === creditId);
    if (credit) {
      this.customerCreditPaymentForm.amount = credit.dueAmount;
    }
  }

  selectCreditForPayment(credit: Credit): void {
    this.customerCreditPaymentForm.customerId = credit.customerId;
    this.customerCreditPaymentForm.creditId = credit.id;
    this.customerCreditPaymentForm.amount = credit.dueAmount;
    const elem = document.getElementById('recordCustomerCreditPaymentCard');
    if (elem) {
      elem.scrollIntoView({ behavior: 'smooth' });
    }
  }

  postCustomerCreditPayment(): void {
    const creditId = Number(this.customerCreditPaymentForm.creditId);
    const amount = Number(this.customerCreditPaymentForm.amount);
    if (!creditId) {
      this.message = 'Error: Please select a customer and an open bill to pay.';
      return;
    }
    const credit = this.credits.find(c => c.id === creditId);
    if (!credit) {
      this.message = 'Error: Selected credit bill not found.';
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      this.message = 'Error: Please enter a valid positive payment amount.';
      return;
    }
    if (amount > credit.dueAmount) {
      this.message = `Error: Payment of ₹${amount} exceeds the remaining due amount of ₹${credit.dueAmount}.`;
      return;
    }

    const mode = this.customerCreditPaymentForm.paymentMode || 'CASH';
    const ref = this.customerCreditPaymentForm.referenceNo || '';

    this.busy = true;
    this.api.payCredit(credit.id, amount, mode, ref).subscribe({
      next: updated => {
        this.busy = false;
        this.credits = updated.status === 'SETTLED'
          ? this.credits.filter(item => item.id !== updated.id)
          : this.credits.map(item => item.id === updated.id ? updated : item);
        this.updateGroupedCredits();
        this.message = `Payment of ₹${amount} successfully posted against ${credit.billNo} (${credit.customerName}).`;
        this.customerCreditPaymentForm = {
          customerId: 0,
          creditId: 0,
          amount: 0,
          paymentMode: 'CASH',
          referenceNo: ''
        };
        this.reload();
      },
      error: error => this.fail(error)
    });
  }

  seedTestCreditCustomers(): void {
    this.busy = true;
    this.api.seedTestCreditCustomers().subscribe({
      next: res => {
        this.busy = false;
        this.message = `Successfully initialized 10 test credit customers with ${res.seededBills} credit bills.`;
        this.reload();
      },
      error: error => this.fail(error)
    });
  }

  billGross(sale: Sale): number {
    if (!sale) return 0;
    return this.billMrpTotal(sale);
  }

  billMrpTotal(sale: Sale): number {
    if (!sale || !sale.items) return 0;
    return sale.items.reduce((sum, item) => sum + ((item.mrp && item.mrp > 0 ? item.mrp : item.sellingPrice) * item.quantity), 0);
  }

  billDiscount(sale: Sale): number {
    if (!sale) return 0;
    const mrpTotal = this.billMrpTotal(sale);
    const saleAmount = sale.netAmount - (sale.roundingAmount ?? 0);
    return Math.max(0, mrpTotal - saleAmount);
  }

  actualItemAmount(sale: Sale, item: any): number {
    if (!sale || !sale.items || !item) return 0;
    const subtotal = sale.items.reduce((sum, i) => sum + (i.totalAmount || 0), 0);
    const finalRatio = subtotal > 0 ? (sale.netAmount - (sale.roundingAmount ?? 0)) / subtotal : 1;
    return Number(((item.totalAmount || 0) * finalRatio).toFixed(2));
  }

  actualPrice(sale: Sale, item: any): number {
    if (!item || !item.quantity) return 0;
    return Number((this.actualItemAmount(sale, item) / item.quantity).toFixed(2));
  }

  actualDiscount(sale: Sale, item: any): number {
    if (!item) return 0;
    const mrp = item.mrp && item.mrp > 0 ? item.mrp : item.sellingPrice;
    return Number((mrp - this.actualPrice(sale, item)).toFixed(2));
  }

  formatBillQty(item: any): string {
    if (!item) return '0';
    const medicine = item.medicine || item;
    const qty = Number(item.quantity || 0);

    // Non-splittable products (syrups, syringes, vials, ointments, otc) -> format with proper unit label
    if (!this.isLooseSellable(medicine)) {
      const wholeQty = Math.round(qty);
      const label = this.getSellUnitLabel(medicine, wholeQty);
      return `${wholeQty} ${label}`;
    }

    // Tablets & Capsules -> format with Strips + Tabs breakdown
    const packSize = this.getPackSize(medicine);
    const totalUnits = Math.round(qty * packSize);
    const strips = Math.floor(totalUnits / packSize);
    const units  = totalUnits % packSize;

    if (strips > 0 && units > 0) {
      return `${strips} Strip(s) + ${units} Tab(s)`;
    } else if (strips > 0) {
      return `${strips} Strip(s)`;
    } else {
      return `${units} Tab(s)`;
    }
  }

  printBill(sale?: Sale): void {
    const s = sale || this.viewingInvoice || this.lastSale;
    if (s) {
      try {
        const doc = this.generatePdfDocument(s);
        if (doc) {
          doc.autoPrint();
          const blob = doc.output('blob');
          const blobUrl = URL.createObjectURL(blob);
          const printWindow = window.open(blobUrl, '_blank');
          if (printWindow) {
            printWindow.focus();
            setTimeout(() => {
              try { printWindow.print(); } catch (e) { }
            }, 400);
          } else {
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.src = blobUrl;
            document.body.appendChild(iframe);
            setTimeout(() => {
              try {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
              } catch (e) { }
            }, 400);
          }
          return;
        }
      } catch (err) {
        console.warn('Error in PDF printBill(), fallback to window.print()', err);
      }
    }
    window.print();
  }

  onLedgerPresetChange(): void {
    const today = new Date();
    const formatDate = (d: Date) => getLocalIsoDate(d);
    switch (this.ledgerDatePreset) {
      case 'today':
        this.ledgerStartDate = formatDate(today);
        this.ledgerEndDate = formatDate(today);
        break;
      case 'week': {
        const start = new Date(today);
        start.setDate(today.getDate() - today.getDay());
        this.ledgerStartDate = formatDate(start);
        this.ledgerEndDate = formatDate(today);
        break;
      }
      case 'month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        this.ledgerStartDate = formatDate(start);
        this.ledgerEndDate = formatDate(today);
        break;
      }
      case 'fy': {
        const currentYear = today.getFullYear();
        const start = today.getMonth() >= 3 ? new Date(currentYear, 3, 1) : new Date(currentYear - 1, 3, 1);
        const end = today.getMonth() >= 3 ? new Date(currentYear + 1, 2, 31) : new Date(currentYear, 2, 31);
        this.ledgerStartDate = formatDate(start);
        this.ledgerEndDate = formatDate(end);
        break;
      }
      default:
        this.ledgerStartDate = '';
        this.ledgerEndDate = '';
        break;
    }
  }

  filteredCustomerCreditHistory(): Credit[] {
    return this.customerCreditHistory.filter(txn => {
      if (this.ledgerStatusFilter && txn.status !== this.ledgerStatusFilter) {
        return false;
      }
      if (txn.billDate) {
        const dateVal = txn.billDate.slice(0, 10);
        if (this.ledgerStartDate && dateVal < this.ledgerStartDate) return false;
        if (this.ledgerEndDate && dateVal > this.ledgerEndDate) return false;
      }
      return true;
    });
  }

  filteredDistributorBillsHistory(): DistributorBillView[] {
    return this.distributorBillsHistory.filter(b => {
      if (this.plStartDate || this.plEndDate) {
        let billDateMatch = false;
        if (b.billDate) {
          const dateVal = b.billDate.slice(0, 10);
          const afterStart = !this.plStartDate || dateVal >= this.plStartDate;
          const beforeEnd  = !this.plEndDate   || dateVal <= this.plEndDate;
          if (afterStart && beforeEnd) billDateMatch = true;
        }

        let posSalesMatch = false;
        const salesInPeriod = this.getSalesInPlDateRange();
        const batchNos = new Set((b.items || []).map(i => i.batchNo).filter(Boolean));
        for (const sale of salesInPeriod) {
          for (const item of (sale.items || [])) {
            if (item.batchNo && batchNos.has(item.batchNo)) {
              posSalesMatch = true;
              break;
            }
          }
          if (posSalesMatch) break;
        }

        return billDateMatch || posSalesMatch;
      }

      return true;
    });
  }

  groupedCwCredits: GroupedCustomerCredit[] = [];
  groupedCredits: GroupedCustomerCredit[] = [];
  cachedFilteredCwCredits: Credit[] = [];

  creditSearchQuery: string = '';
  creditPageIndex: number = 0;
  creditPageSize: number = 5;
  filteredGroupedCredits: GroupedCustomerCredit[] = [];
  paginatedGroupedCredits: GroupedCustomerCredit[] = [];

  trackByCustomerId(index: number, item: GroupedCustomerCredit): number | string {
    return item.customerId || item.customerName;
  }

  trackByCreditId(index: number, item: Credit): number {
    return item.id;
  }

  onCreditSearchChange(): void {
    this.creditPageIndex = 0;
    this.updatePaginatedCredits();
  }

  updatePaginatedCredits(): void {
    const q = (this.creditSearchQuery || '').trim().toLowerCase();
    if (!q) {
      this.filteredGroupedCredits = [...this.groupedCredits];
    } else {
      this.filteredGroupedCredits = this.groupedCredits.filter(g => {
        const nameMatch = (g.customerName || '').toLowerCase().includes(q);
        const billMatch = (g.bills || []).some(b => (b.billNo || '').toLowerCase().includes(q));
        const customer = this.customers.find(cust => cust.id === g.customerId);
        const mobileMatch = customer && customer.mobile ? customer.mobile.includes(q) : false;
        return nameMatch || billMatch || mobileMatch;
      });
    }

    const totalPages = this.getCreditTotalPages();
    if (this.creditPageIndex >= totalPages) {
      this.creditPageIndex = Math.max(0, totalPages - 1);
    }

    const start = this.creditPageIndex * this.creditPageSize;
    const end = start + this.creditPageSize;
    this.paginatedGroupedCredits = this.filteredGroupedCredits.slice(start, end);
  }

  getCreditTotalPages(): number {
    return Math.max(1, Math.ceil((this.filteredGroupedCredits?.length || 0) / this.creditPageSize));
  }

  getCreditDisplayRange(): string {
    const total = this.filteredGroupedCredits?.length || 0;
    if (total === 0) return '0 of 0 Customers';
    const start = (this.creditPageIndex * this.creditPageSize) + 1;
    const end = Math.min((this.creditPageIndex + 1) * this.creditPageSize, total);
    return `Showing ${start} to ${end} of ${total} Customers`;
  }

  getCreditPageNumbers(): number[] {
    const total = this.getCreditTotalPages();
    return Array.from({ length: total }, (_, i) => i);
  }

  prevCreditPage(): void {
    if (this.creditPageIndex > 0) {
      this.creditPageIndex--;
      this.updatePaginatedCredits();
    }
  }

  nextCreditPage(): void {
    if (this.creditPageIndex < this.getCreditTotalPages() - 1) {
      this.creditPageIndex++;
      this.updatePaginatedCredits();
    }
  }

  setCreditPage(pageIndex: number): void {
    this.creditPageIndex = pageIndex;
    this.updatePaginatedCredits();
  }

  updateGroupedCredits(): void {
    if (!this.credits) {
      this.cachedFilteredCwCredits = [];
      this.groupedCwCredits = [];
      this.groupedCredits = [];
      this.filteredGroupedCredits = [];
      this.paginatedGroupedCredits = [];
      return;
    }

    this.cachedFilteredCwCredits = this.credits.filter((c: Credit) => {
      if (!c.billDate) return true;
      const dateVal = c.billDate.slice(0, 10);
      if (this.cwStartDate && dateVal < this.cwStartDate) return false;
      if (this.cwEndDate && dateVal > this.cwEndDate) return false;
      return true;
    });

    this.groupedCwCredits = this.groupCreditsByCustomer(this.cachedFilteredCwCredits);
    this.groupedCredits = this.groupCreditsByCustomer(this.credits);
    this.updatePaginatedCredits();
  }

  filteredCwCredits(): Credit[] {
    return this.cachedFilteredCwCredits;
  }

  getGroupedCwCredits(): GroupedCustomerCredit[] {
    return this.groupedCwCredits;
  }

  getGroupedCredits(): GroupedCustomerCredit[] {
    return this.groupedCredits;
  }

  groupCreditsByCustomer(creditList: Credit[]): GroupedCustomerCredit[] {
    if (!creditList || creditList.length === 0) return [];
    const map = new Map<string, GroupedCustomerCredit>();
    for (const c of creditList) {
      const key = String(c.customerId || c.customerName);
      if (!map.has(key)) {
        map.set(key, {
          customerId: c.customerId,
          customerName: c.customerName,
          totalCreditAmount: 0,
          totalPaidAmount: 0,
          totalDueAmount: 0,
          billsCount: 0,
          earliestDueDate: c.dueDate,
          latestDueDate: c.dueDate,
          bills: [],
          isExpanded: true
        });
      }
      const group = map.get(key)!;
      group.totalCreditAmount += Number(c.creditAmount || 0);
      group.totalPaidAmount += Number(c.paidAmount || 0);
      group.totalDueAmount += Number(c.dueAmount || 0);
      group.billsCount += 1;
      group.bills.push(c);
      if (c.dueDate) {
        if (!group.earliestDueDate || c.dueDate < group.earliestDueDate) group.earliestDueDate = c.dueDate;
        if (!group.latestDueDate || c.dueDate > group.latestDueDate) group.latestDueDate = c.dueDate;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalDueAmount - a.totalDueAmount);
  }

  creditTab: 'dues' | 'paid' = 'dues';
  settledCreditsList: Credit[] = [];
  groupedSettledCredits: GroupedCustomerCredit[] = [];
  filteredGroupedSettledCredits: GroupedCustomerCredit[] = [];
  paginatedGroupedSettledCredits: GroupedCustomerCredit[] = [];
  settledPageIndex: number = 0;
  settledPageSize: number = 5;
  settledSearchQuery: string = '';

  loadSettledCredits(): void {
    this.api.settledCredits().subscribe({
      next: data => {
        this.settledCreditsList = data || [];
        this.updateGroupedSettledCredits();
      },
      error: error => this.fail(error)
    });
  }

  updateGroupedSettledCredits(): void {
    this.groupedSettledCredits = this.groupCreditsByCustomer(this.settledCreditsList);
    this.updatePaginatedSettledCredits();
  }

  onSettledSearchChange(): void {
    this.settledPageIndex = 0;
    this.updatePaginatedSettledCredits();
  }

  updatePaginatedSettledCredits(): void {
    const q = (this.settledSearchQuery || '').trim().toLowerCase();
    if (!q) {
      this.filteredGroupedSettledCredits = [...this.groupedSettledCredits];
    } else {
      this.filteredGroupedSettledCredits = this.groupedSettledCredits.filter(g => {
        const nameMatch = (g.customerName || '').toLowerCase().includes(q);
        const billMatch = (g.bills || []).some(b => (b.billNo || '').toLowerCase().includes(q));
        const customer = this.customers.find(cust => cust.id === g.customerId);
        const mobileMatch = customer && customer.mobile ? customer.mobile.includes(q) : false;
        return nameMatch || billMatch || mobileMatch;
      });
    }

    const totalPages = this.getSettledTotalPages();
    if (this.settledPageIndex >= totalPages) {
      this.settledPageIndex = Math.max(0, totalPages - 1);
    }

    const start = this.settledPageIndex * this.settledPageSize;
    const end = start + this.settledPageSize;
    this.paginatedGroupedSettledCredits = this.filteredGroupedSettledCredits.slice(start, end);
  }

  getSettledTotalPages(): number {
    return Math.max(1, Math.ceil((this.filteredGroupedSettledCredits?.length || 0) / this.settledPageSize));
  }

  getSettledDisplayRange(): string {
    const total = this.filteredGroupedSettledCredits?.length || 0;
    if (total === 0) return '0 of 0 Customers';
    const start = (this.settledPageIndex * this.settledPageSize) + 1;
    const end = Math.min((this.settledPageIndex + 1) * this.settledPageSize, total);
    return `Showing ${start} to ${end} of ${total} Customers`;
  }

  getSettledPageNumbers(): number[] {
    const total = this.getSettledTotalPages();
    return Array.from({ length: total }, (_, i) => i);
  }

  prevSettledPage(): void {
    if (this.settledPageIndex > 0) {
      this.settledPageIndex--;
      this.updatePaginatedSettledCredits();
    }
  }

  nextSettledPage(): void {
    if (this.settledPageIndex < this.getSettledTotalPages() - 1) {
      this.settledPageIndex++;
      this.updatePaginatedSettledCredits();
    }
  }

  setSettledPage(pageIndex: number): void {
    this.settledPageIndex = pageIndex;
    this.updatePaginatedSettledCredits();
  }

  isCustomerGroupSelected(group: GroupedCustomerCredit): boolean {
    return group.bills.length > 0 && group.bills.every((b: Credit) => this.selectedCreditIds.has(b.id));
  }

  isCustomerGroupPartiallySelected(group: GroupedCustomerCredit): boolean {
    const selectedCount = group.bills.filter((b: Credit) => this.selectedCreditIds.has(b.id)).length;
    return selectedCount > 0 && selectedCount < group.bills.length;
  }

  toggleSelectCustomerGroup(group: GroupedCustomerCredit): void {
    const allSelected = this.isCustomerGroupSelected(group);
    group.bills.forEach((b: Credit) => {
      if (allSelected) {
        this.selectedCreditIds.delete(b.id);
      } else {
        this.selectedCreditIds.add(b.id);
      }
    });
  }

  sendWhatsAppCustomerGroupReminder(group: GroupedCustomerCredit): void {
    if (!group.bills || group.bills.length === 0) return;
    this.showConfirm(
      `Send WhatsApp dues reminder to ${group.customerName} for total outstanding due of ₹${group.totalDueAmount.toFixed(2)} (${group.billsCount} pending bill${group.billsCount > 1 ? 's' : ''})?`,
      () => {
        this.submitWhatsAppCreditReminderPayload(group.bills[0]);
      },
      'Send WhatsApp Customer Reminder'
    );
  }

  onPlPresetChange(): void {
    const today = new Date();
    const formatDate = (d: Date) => getLocalIsoDate(d);
    switch (this.plDatePreset) {
      case 'today':
        this.plStartDate = formatDate(today);
        this.plEndDate = formatDate(today);
        break;
      case 'week': {
        const start = new Date(today);
        start.setDate(today.getDate() - today.getDay());
        this.plStartDate = formatDate(start);
        this.plEndDate = formatDate(today);
        break;
      }
      case 'month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        this.plStartDate = formatDate(start);
        this.plEndDate = formatDate(today);
        break;
      }
      case 'fy': {
        const currentYear = today.getFullYear();
        const start = today.getMonth() >= 3 ? new Date(currentYear, 3, 1) : new Date(currentYear - 1, 3, 1);
        const end = today.getMonth() >= 3 ? new Date(currentYear + 1, 2, 31) : new Date(currentYear, 2, 31);
        this.plStartDate = formatDate(start);
        this.plEndDate = formatDate(end);
        break;
      }
      default:
        this.plStartDate = '';
        this.plEndDate = '';
        break;
    }
  }

  onCwPresetChange(): void {
    const today = new Date();
    const formatDate = (d: Date) => getLocalIsoDate(d);
    switch (this.cwDatePreset) {
      case 'today':
        this.cwStartDate = formatDate(today);
        this.cwEndDate = formatDate(today);
        break;
      case 'week': {
        const start = new Date(today);
        start.setDate(today.getDate() - today.getDay());
        this.cwStartDate = formatDate(start);
        this.cwEndDate = formatDate(today);
        break;
      }
      case 'month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        this.cwStartDate = formatDate(start);
        this.cwEndDate = formatDate(today);
        break;
      }
      case 'fy': {
        const currentYear = today.getFullYear();
        const start = today.getMonth() >= 3 ? new Date(currentYear, 3, 1) : new Date(currentYear - 1, 3, 1);
        const end = today.getMonth() >= 3 ? new Date(currentYear + 1, 2, 31) : new Date(currentYear, 2, 31);
        this.cwStartDate = formatDate(start);
        this.cwEndDate = formatDate(end);
        break;
      }
      default:
        this.cwStartDate = '';
        this.cwEndDate = '';
        break;
    }
    this.updateGroupedCredits();
  }

  // old sales history methods removed

  saveStoreConfigSection(section: 'store' | 'whatsapp' | 'reminder'): void {
    if (section === 'store') {
      if (!this.storeBill.name?.trim() ||
        !this.storeBill.addressLine1?.trim() ||
        !this.storeBill.addressLine2?.trim() ||
        !this.storeBill.phone?.trim() ||
        !this.storeBill.drugLicense22?.trim() ||
        !this.storeBill.drugLicense21?.trim() ||
        !this.storeBill.gstNumber?.trim()) {
        this.message = 'Please fill out all mandatory store settings fields (marked with *).';
        return;
      }
    }
    if (section === 'reminder') {
      if (this.storeBill.enableAutoReminders) {
        if (!this.storeBill.reminderDays || this.storeBill.reminderDays < 1) {
          this.message = 'Reminder threshold must be at least 1 day.';
          return;
        }
        if (!this.storeBill.dailyReminderTime?.trim()) {
          this.message = 'Daily reminder run time is required.';
          return;
        }
      }
    }

    this.busy = true;
    this.api.saveStoreConfig(this.storeBill).subscribe({
      next: () => {
        this.busy = false;
        this.message = 'Configuration section updated successfully.';
        if (section === 'store') this.editingStoreSettings = false;
        if (section === 'whatsapp') this.editingWhatsAppConfig = false;
        if (section === 'reminder') this.editingReminderConfig = false;
        this.loadStoreConfig();
      },
      error: error => {
        this.busy = false;
        this.fail(error);
      }
    });
  }

  cancelStoreConfigSection(section: 'store' | 'whatsapp' | 'reminder'): void {
    if (section === 'store') this.editingStoreSettings = false;
    if (section === 'whatsapp') this.editingWhatsAppConfig = false;
    if (section === 'reminder') this.editingReminderConfig = false;
    this.loadStoreConfig();
  }

  openDistributorLedger(distributor: Distributor): void {
    if (this.view !== 'distributor-ledger') {
      this.viewHistory.push(this.view);
    }
    this.selectedDistributor = distributor;
    this.ledgerTab = 'credit';
    this.show('distributor-ledger', false);
    this.loadDistributorLedgerData();
  }

  loadDistributorLedgerData(): void {
    if (!this.selectedDistributor) return;
    this.busy = true;
    this.api.distributorBills(this.selectedDistributor.id).subscribe({
      next: bills => {
        this.distributorBillsList = bills;
        this.busy = false;
      },
      error: error => this.fail(error)
    });
    this.api.distributorPayments(this.selectedDistributor.id).subscribe({
      next: payments => {
        this.distributorPaymentsList = payments;
      },
      error: error => this.fail(error)
    });
  }

  viewDistributorBill(bill: DistributorBillView): void {
    this.returnView = this.view;
    if (this.view !== 'distributor-invoice') {
      this.viewHistory.push(this.view);
    }
    if (bill.distributorName) {
      const targetName = bill.distributorName.trim().toLowerCase();
      const dist = this.distributors.find(d => d.name.trim().toLowerCase() === targetName);
      if (dist) {
        this.selectedDistributor = dist;
        this.loadDistributorLedgerData();
      }
    }
    this.selectedDistributorBill = bill;
    this.view = 'distributor-invoice';
  }

  private loadTesseract(): Promise<any> {
    if ((window as any).Tesseract) {
      return Promise.resolve((window as any).Tesseract);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve((window as any).Tesseract);
      script.onerror = () => reject(new Error('Failed to load OCR engine. Please check internet connection.'));
      document.head.appendChild(script);
    });
  }

  private preprocessImageCanvas(
    file: File,
    crop?: { x: number; y: number; width: number; height: number },
    maxDim = 2400
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(url);
          return;
        }
        const sx = crop ? Math.max(0, Math.floor(img.width * crop.x)) : 0;
        const sy = crop ? Math.max(0, Math.floor(img.height * crop.y)) : 0;
        const sw = crop ? Math.min(img.width - sx, Math.floor(img.width * crop.width)) : img.width;
        const sh = crop ? Math.min(img.height - sy, Math.floor(img.height * crop.height)) : img.height;

        let w = sw;
        let h = sh;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(this.enhanceCanvasToDataUrl(canvas));
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
  }

  private enhanceCanvasToDataUrl(canvas: HTMLCanvasElement): string {
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');

    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minV = 255, maxV = 0;
    const grays = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const g = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      grays[j] = g;
      if (g < minV) minV = g;
      if (g > maxV) maxV = g;
    }

    const range = maxV - minV || 1;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const normalized = Math.min(255, Math.max(0, ((grays[j] - minV) / range) * 255));
      const v = normalized < 145 ? Math.max(0, normalized - 35) : Math.min(255, normalized + 35);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  private billOcrOptions(pageSegMode = '6'): Record<string, string> {
    return {
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: pageSegMode,
      user_defined_dpi: '300'
    };
  }

  private normalizeBillText(text: string): string {
    return (text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[|¦]/g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  private splitConcatenatedBillRows(text: string): string[] {
    const source = this.normalizeBillText(text).trim();
    if (!source) return [];

    const starts: number[] = [];
    const startRegex = /(^|\s)(?=(?:[A-Z][A-Z0-9&.\-]{1,11}\s*\d{4,8}|[A-Z][A-Z0-9&.\-]{1,11}\d{4,8})\s+[A-Z0-9])/gi;
    let match: RegExpExecArray | null;
    while ((match = startRegex.exec(source)) !== null) {
      const idx = match.index + (match[1] ? match[1].length : 0);
      if (!starts.includes(idx)) starts.push(idx);
      if (startRegex.lastIndex === match.index) startRegex.lastIndex++;
    }

    if (starts.length <= 1) return [source];

    const rows: string[] = [];
    starts.sort((a, b) => a - b);
    for (let i = 0; i < starts.length; i++) {
      const row = source.substring(starts[i], starts[i + 1] ?? source.length).trim();
      if (row) rows.push(row);
    }
    return rows;
  }

  private mergeParsedItems(items: any[]): any[] {
    const byKey = new Map<string, any>();
    const score = (item: any) =>
      ['medicineName', 'manufacturer', 'hsnCode', 'category', 'batchNo', 'expiryDate']
        .filter(key => !!item[key] && !['Unknown', 'General', 'B-NEW', '300490'].includes(String(item[key]))).length +
      ['quantity', 'purchasePrice', 'mrp', 'gstPercentage'].filter(key => Number(item[key]) > 0).length;

    for (const item of items.filter(Boolean)) {
      const key = [
        String(item.medicineName || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
        String(item.batchNo || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
        String(item.expiryDate || '')
      ].join('|');
      const existing = byKey.get(key);
      if (!existing || score(item) > score(existing)) {
        byKey.set(key, item);
      }
    }
    const result = Array.from(byKey.values());
    result.forEach(item => this.populateCompositionFromMaster(item));
    return result;
  }

  csvCompositionMap: Map<string, { composition: string; sideEffects?: string; manufacturer?: string }> = new Map();

  loadDefaultCompositionCsv(): void {
    this.api.getMasterCompositionsCsv().subscribe({
      next: csv => this.parseCsvContent(csv),
      error: () => {
        const fallbackCsv = `Medicine Name,Composition (with mg strength),Side Effects,Manufacturer,Category
Augmentin 625 Duo Tablet,Amoxycillin (500mg) + Clavulanic Acid (125mg),"Vomiting, Nausea, Diarrhea",Glaxo SmithKline Pharmaceuticals Ltd,Antibiotic
Azithral 500 Tablet,Azithromycin (500mg),"Vomiting, Nausea, Abdominal pain, Diarrhea",Alembic Pharmaceuticals Ltd,Antibiotic
Ascoril LS Syrup,Ambroxol (30mg/5ml) + Levosalbutamol (1mg/5ml) + Guaifenesin (50mg/5ml),"Nausea, Vomiting, Diarrhea, Tremor, Headache",Glenmark Pharmaceuticals Ltd,Cough & Cold
Allegra 120mg Tablet,Fexofenadine (120mg),"Headache, Drowsiness, Dizziness, Nausea",Sanofi India Ltd,Antihistamine
Avil 25 Tablet,Pheniramine (25mg),"Sleepiness, Dry mouth",Sanofi India Ltd,Antihistamine
Allegra-M Tablet,Montelukast (10mg) + Fexofenadine (120mg),"Nausea, Diarrhea, Vomiting, Skin rash, Headache",Sanofi India Ltd,Antihistamine
Amoxyclav 625 Tablet,Amoxycillin (500mg) + Clavulanic Acid (125mg),"Vomiting, Nausea, Diarrhea",Abbott,Antibiotic
Azee 500 Tablet,Azithromycin (500mg),"Vomiting, Nausea, Abdominal pain, Diarrhea",Cipla Ltd,Antibiotic
Atarax 25mg Tablet,Hydroxyzine (25mg),"Sedation, Nausea, Vomiting, Constipation",Dr Reddy's Laboratories Ltd,Anti-allergic
Aciloc 150 Tablet,Ranitidine (150mg),"Sleepiness, Headache, Tiredness, Constipation, Diarrhea",Cadila Pharmaceuticals Ltd,Antacid
Dolo 650 Tablet,Paracetamol (650mg),"Nausea, Allergic reaction, Liver toxicity on high dose",Micro Labs Ltd,Analgesic
Crocin Advance Tablet,Paracetamol (500mg),"Nausea, Overdose toxicity",GlaxoSmithKline,Analgesic
Pan-D Capsule,Pantoprazole (40mg) + Domperidone (30mg),"Dry mouth, Headache, Flatulence",Alkem Laboratories Ltd,Gastroenterology
Pantocid 40 Tablet,Pantoprazole (40mg),"Headache, Diarrhea, Nausea",Sun Pharmaceutical Industries Ltd,Gastroenterology
Combiflam Tablet,Ibuprofen (400mg) + Paracetamol (325mg),"Heartburn, Stomach pain, Nausea",Sanofi India Ltd,Analgesic
Cheston Cold Tablet,Cetirizine (5mg) + Paracetamol (325mg) + Phenylephrine (10mg),"Drowsiness, Dry mouth, Dizziness",Cipla Ltd,Cough & Cold
Zifi 200 Tablet,Cefixime (200mg),"Nausea, Diarrhea, Stomach pain",FDC Ltd,Antibiotic
Taxim-O 200 Tablet,Cefixime (200mg),"Diarrhea, Nausea, Abdominal pain",Alkem Laboratories Ltd,Antibiotic
Oflomac 200 Tablet,Ofloxacin (200mg),"Nausea, Headache, Dizziness",Mankind Pharma Ltd,Antibiotic
Cifran 500 Tablet,Ciprofloxacin (500mg),"Nausea, Diarrhea, Dizziness",Sun Pharmaceutical Industries Ltd,Antibiotic
GLIMP-M1 TAB,Glimepiride 1mg + Metformin 500mg,"Hypoglycemia, Nausea",Biochem,Diabetes
Amlodipine 5 Tablet,Amlodipine (5mg),"Ankle swelling, Dizziness",HeartMed,Cardiology
Glycomet 500 Tablet,Metformin (500mg),"GI distress, Metallic taste",USV Ltd,Diabetes
Calpol 500 Tablet,Paracetamol (500mg),"Liver toxicity on high dose",GlaxoSmithKline,Analgesic
Lipitor 10mg Tablet,Atorvastatin (10mg),"Muscle pain, Liver enzyme elevation",Pfizer Ltd,Cardiology`;
        this.parseCsvContent(fallbackCsv);
      }
    });
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  parseCsvContent(csvText: string): void {
    if (!csvText) return;
    const lines = csvText.split(/\r?\n/);
    if (lines.length === 0) return;

    const firstLine = lines[0].toLowerCase();
    const isIndianDataFormat = firstLine.includes('salt_composition') || firstLine.includes('short_composition');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = this.parseCsvLine(line);

      if (isIndianDataFormat) {
        // Indian Medicine Dataset format: id,name,price,Is_discontinued,manufacturer_name,type,pack_size_label,short_composition1,short_composition2,salt_composition,medicine_desc,side_effects,...
        const medName = (parts[1] || '').trim();
        const manufacturer = (parts[4] || '').trim();
        const composition = (parts[9] || parts[7] || '').trim();
        const sideEffects = (parts[11] || '').trim();

        if (medName && (composition || sideEffects)) {
          this.csvCompositionMap.set(medName.toLowerCase(), {
            composition: composition || 'Standard Composition',
            sideEffects: sideEffects,
            manufacturer: manufacturer || 'Pharmaceutical Manufacturer'
          });
        }
      } else {
        // Standard format: Medicine Name,Composition (with mg strength),Side Effects,Manufacturer,Category
        if (parts.length >= 2) {
          const medName = (parts[0] || '').trim();
          const composition = (parts[1] || '').trim();
          const sideEffects = (parts[2] || '').trim();
          const manufacturer = (parts[3] || '').trim();
          if (medName && composition) {
            this.csvCompositionMap.set(medName.toLowerCase(), { composition, sideEffects, manufacturer });
          }
        }
      }
    }
  }

  onKnowMedicineQueryChange(): void {
    const q = this.knowMedicineQuery.trim();
    this.knowMedicineSelected = null;
    if (!q) {
      this.knowMedicineResults = [];
      return;
    }
    this.knowMedicineSearching = true;
    this.api.searchMasterMedicines(q, 30).subscribe({
      next: results => {
        this.knowMedicineResults = results || [];
        this.knowMedicineSearching = false;
      },
      error: () => {
        this.knowMedicineSearching = false;
        this.knowMedicineResults = [];
      }
    });
  }

  onKnowMedicineSearch(): void {
    this.onKnowMedicineQueryChange();
  }

  quickSearchKnowMedicine(term: string): void {
    this.knowMedicineQuery = term;
    this.knowMedicineSelected = null;
    this.onKnowMedicineSearch();
  }

  selectKnowMedicine(med: MasterMedicineView): void {
    this.knowMedicineSelected = med;
    this.knowMedicineResults = [];
  }

  clearKnowMedicine(): void {
    this.knowMedicineQuery = '';
    this.knowMedicineResults = [];
    this.knowMedicineSelected = null;
  }

  formatSideEffectsList(sideEffects?: string): string[] {
    if (!sideEffects || !sideEffects.trim()) return [];
    return sideEffects.split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  }

  handleCsvMasterUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const content = e.target.result as string;
      this.parseCsvContent(content);
      this.message = `Successfully loaded ${this.csvCompositionMap.size} compositions from test CSV file (${file.name})!`;
      if (this.uploadedItems) {
        this.uploadedItems.forEach(item => this.populateCompositionFromMaster(item));
      }
    };
    reader.readAsText(file);
  }

  autoFetchCompositionFromMaster(medicineName: string, targetObj: any): void {
    if (!medicineName || !medicineName.trim() || medicineName.trim().length < 2) return;
    const query = medicineName.trim();
    this.api.searchMasterMedicines(query, 5).subscribe({
      next: results => {
        if (results && results.length > 0) {
          const match = results[0];
          if (match.saltComposition && (!targetObj.genericName || !targetObj.genericName.trim())) {
            targetObj.genericName = match.saltComposition;
            targetObj.autoPopulated = true;
          }
          if (match.sideEffects && (!targetObj.sideEffects || !targetObj.sideEffects.trim())) {
            targetObj.sideEffects = match.sideEffects;
          }
          if (match.manufacturerName && (!targetObj.manufacturer || !targetObj.manufacturer.trim())) {
            targetObj.manufacturer = match.manufacturerName;
          }
        }
      }
    });
  }

  populateCompositionFromMaster(item: any): void {
    if (!item) return;
    if (!item.genericName || !item.genericName.trim()) {
      const normName = (item.medicineName || '').trim().toLowerCase();
      const codeStr = (item.medicineCode || '').trim().toLowerCase();
      if (!normName && !codeStr) return;

      // 1. Check CSV master dataset
      const csvMatch = this.csvCompositionMap.get(normName);
      if (csvMatch) {
        item.genericName = csvMatch.composition;
        if (csvMatch.sideEffects) item.sideEffects = csvMatch.sideEffects;
        item.autoPopulated = true;
        return;
      }

      // Check partial match in CSV map
      for (const [key, val] of this.csvCompositionMap.entries()) {
        if (normName.includes(key) || key.includes(normName)) {
          item.genericName = val.composition;
          if (val.sideEffects) item.sideEffects = val.sideEffects;
          item.autoPopulated = true;
          return;
        }
      }

      // 2. Check loaded inventory medicines
      const matched = this.medicines.find(m =>
        (codeStr && m.code && m.code.trim().toLowerCase() === codeStr) ||
        (normName && m.name && m.name.trim().toLowerCase() === normName) ||
        (normName && m.name && m.name.trim().toLowerCase().includes(normName)) ||
        (normName && m.name && normName.includes(m.name.trim().toLowerCase()))
      );
      if (matched && matched.genericName) {
        item.genericName = matched.genericName;
        if (matched.sideEffects) item.sideEffects = matched.sideEffects;
        item.autoPopulated = true;
        return;
      }

      // 3. Auto fetch from MySQL Master Database via API
      this.autoFetchCompositionFromMaster(item.medicineName, item);
    }
  }

  activeCompositionSearchIdx: number | null = null;

  getUniqueMasterCompositions(): string[] {
    const set = new Set<string>();
    for (const m of this.medicines) {
      if (m.genericName && m.genericName.trim()) {
        set.add(m.genericName.trim());
      }
    }
    for (const val of this.csvCompositionMap.values()) {
      if (val.composition && val.composition.trim()) {
        set.add(val.composition.trim());
      }
    }
    return Array.from(set).sort();
  }

  getCompositionSuggestions(item: any): string[] {
    const query = (item.genericName || '').trim().toLowerCase();

    if (this.csvCompositionMap.size === 0) {
      this.loadDefaultCompositionCsv();
    }

    const set = new Set<string>();

    for (const m of this.medicines) {
      if (m.genericName && m.genericName.trim()) {
        set.add(m.genericName.trim());
      }
    }

    for (const val of this.csvCompositionMap.values()) {
      if (val.composition && val.composition.trim()) {
        set.add(val.composition.trim());
      }
    }

    for (const m of this.backendMasterSearchResults) {
      if (m.genericName && m.genericName.trim() && m.genericName !== 'Standard Composition') {
        set.add(m.genericName.trim());
      }
    }

    const allCompositions = Array.from(set);

    if (!query) {
      if (item.medicineName && item.medicineName.trim()) {
        const medNameLower = item.medicineName.trim().toLowerCase();
        const csvMatch = this.csvCompositionMap.get(medNameLower);
        if (csvMatch && csvMatch.composition) {
          const compTrimmed = csvMatch.composition.trim();
          return [compTrimmed, ...allCompositions.filter(c => c.trim().toLowerCase() !== compTrimmed.toLowerCase())].slice(0, 10);
        }
      }
      return allCompositions.slice(0, 10);
    }

    const terms: string[] = query.split(/[\s,]+/).filter((t: string) => t.length > 0);
    const firstTerm = terms[0];

    const matching = allCompositions.filter(comp => {
      const compLower = comp.toLowerCase();
      return terms.every((t: string) => compLower.includes(t));
    });

    return matching.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();

      if (aLower === query) return -1;
      if (bLower === query) return 1;

      const aStartFull = aLower.startsWith(query);
      const bStartFull = bLower.startsWith(query);
      if (aStartFull && !bStartFull) return -1;
      if (!aStartFull && bStartFull) return 1;

      const aStartFirst = aLower.startsWith(firstTerm);
      const bStartFirst = bLower.startsWith(firstTerm);
      if (aStartFirst && !bStartFirst) return -1;
      if (!aStartFirst && bStartFirst) return 1;

      const aWords = aLower.split(/[\s\-_+]+/);
      const bWords = bLower.split(/[\s\-_+]+/);
      const aWordStart = aWords.some(w => w.startsWith(firstTerm));
      const bWordStart = bWords.some(w => w.startsWith(firstTerm));
      if (aWordStart && !bWordStart) return -1;
      if (!aWordStart && bWordStart) return 1;

      return aLower.localeCompare(bLower);
    }).slice(0, 12);
  }

  selectCompositionForBulkItem(item: any, comp: string): void {
    item.genericName = comp;
    item.compositionError = false;
    item.autoPopulated = true;
    this.activeCompositionSearchIdx = null;
  }

  onCompositionInputChange(item: any): void {
    if (item.genericName && item.genericName.trim()) {
      item.compositionError = false;
    }
  }

  private extractItemsFromText(text: string): any[] {
    if (!text) return [];
    const dateRegexGlobal = /(0[1-9]|1[0-2])[\-\/\u2013\u2014\\_\s\.\,lIi|]+(20[2-3][0-9]|[2-3][0-9])\b/g;
    const rawLines: string[] = [];
    const normalized = this.normalizeBillText(text);
    normalized.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      for (const row of this.splitConcatenatedBillRows(trimmed)) {
        if (row !== trimmed) rawLines.push(row);
      }
      const matches = Array.from(trimmed.matchAll(dateRegexGlobal));
      if (matches.length > 1) {
        let lastEnd = 0;
        for (let i = 0; i < matches.length; i++) {
          const nextIdx = (i < matches.length - 1) ? (matches[i + 1].index || trimmed.length) : trimmed.length;
          const subRow = trimmed.substring(lastEnd, nextIdx).trim();
          if (subRow) rawLines.push(subRow);
          lastEnd = nextIdx;
        }
      } else {
        rawLines.push(trimmed);
      }
    });

    const tableText = normalized
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !this.isHeaderOrFooterJunkLine(line))
      .join(' ');
    rawLines.push(...this.splitConcatenatedBillRows(tableText));

    return this.mergeParsedItems(rawLines.map(l => this.parseSingleBillTextLine(l)).filter(Boolean));
  }

  private extractItemsFromOcrResult(result: any): any[] {
    const parsedItems = this.extractItemsFromText(result?.data?.text || '');
    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    if (words.length === 0) return parsedItems;

    const normalizedWords = words
      .map((word: any) => {
        const text = String(word.text || '').trim();
        const bbox = word.bbox || {};
        const y0 = Number(bbox.y0 ?? word.y0 ?? 0);
        const y1 = Number(bbox.y1 ?? word.y1 ?? y0);
        const x0 = Number(bbox.x0 ?? word.x0 ?? 0);
        return { text, x0, y: (y0 + y1) / 2, h: Math.max(8, y1 - y0) };
      })
      .filter((word: any) => word.text);

    normalizedWords.sort((a: any, b: any) => a.y - b.y || a.x0 - b.x0);
    const rows: any[][] = [];
    for (const word of normalizedWords) {
      const current = rows[rows.length - 1];
      const threshold = Math.max(12, word.h * 0.8);
      if (!current || Math.abs(current[0].y - word.y) > threshold) {
        rows.push([word]);
      } else {
        current.push(word);
      }
    }

    for (const row of rows) {
      row.sort((a: any, b: any) => a.x0 - b.x0);
      const rowText = row.map((word: any) => word.text).join(' ');
      parsedItems.push(...this.extractItemsFromText(rowText));
    }

    return this.mergeParsedItems(parsedItems);
  }

  private extractBillMetadata(text: string): { billNo: string; billDate: string; dueDate: string } {
    const normalized = this.normalizeBillText(text);
    const datePattern = String.raw`(\d{2}[-\/\.]\d{2}[-\/\.]\d{2,4}|\d{4}[-\/\.]\d{2}[-\/\.]\d{2})`;
    const meta = { billNo: '', billDate: '', dueDate: '' };

    const invoicePatterns = [
      /\b(?:INV|INVOICE|BILL)\s*(?:NO|NUMBER|#|N0)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
      /\b(?:INV|INVOICE|BILL)\s*(?:NO|NUMBER|#|N0)\.?\s+([A-Z0-9\/\-]+)/i
    ];
    for (const pattern of invoicePatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        meta.billNo = match[1].trim();
        break;
      }
    }

    const billDateMatch = normalized.match(new RegExp(String.raw`\b(?:INV|INVOICE|BILL)\s*DATE\s*[:\-]?\s*${datePattern}`, 'i'))
      || normalized.match(new RegExp(String.raw`\bDATE\s*[:\-]?\s*${datePattern}`, 'i'));
    if (billDateMatch?.[1]) meta.billDate = billDateMatch[1];

    const dueDateMatch = normalized.match(new RegExp(String.raw`\b(?:DUE\s*DATE|DUE\s*DT|PAYMENT\s*DUE)\s*[:\-]?\s*${datePattern}`, 'i'));
    if (dueDateMatch?.[1]) meta.dueDate = dueDateMatch[1];

    return meta;
  }

  handleBillFileUpload(event: Event, distributorId: number): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name);

    if (isImage) {
      this.busy = true;
      this.message = 'Enhancing bill photo & scanning OCR... Please wait a moment.';
      const rawImgUrl = URL.createObjectURL(file);
      Promise.all([
        this.preprocessImageCanvas(file),
        this.preprocessImageCanvas(file, { x: 0.03, y: 0.28, width: 0.94, height: 0.42 }, 3200)
      ]).then(async ([processedImgUrl, tableImgUrl]) => {
        try {
          const Tesseract = await this.loadTesseract();
          const attempts = [
            { url: processedImgUrl, options: this.billOcrOptions('6') },
            { url: tableImgUrl, options: this.billOcrOptions('6') },
            { url: rawImgUrl, options: this.billOcrOptions('11') }
          ];
          const allItems: any[] = [];
          let combinedText = '';

          for (const attempt of attempts) {
            const result = await Tesseract.recognize(attempt.url, 'eng', attempt.options);
            combinedText += '\n' + (result?.data?.text || '');
            allItems.push(...this.extractItemsFromOcrResult(result));
          }

          URL.revokeObjectURL(rawImgUrl);
          const parsedItems = this.mergeParsedItems(allItems);
          if (parsedItems.length > 0) {
            const metadata = this.extractBillMetadata(combinedText);
            this.finishBillUpload(parsedItems, distributorId, file.name, metadata, 'bill');
          } else {
            this.processBillTextContent(combinedText, distributorId, file.name);
          }
          input.value = '';
        } catch (err: any) {
          URL.revokeObjectURL(rawImgUrl);
          this.busy = false;
          this.message = 'Failed to scan image OCR: ' + (err.message || err);
          input.value = '';
        }
      }).catch(err => {
        URL.revokeObjectURL(rawImgUrl);
        this.busy = false;
        this.message = 'Failed to prepare bill image: ' + (err.message || err);
        input.value = '';
      });
      return;
    }

    this.busy = true;
    this.message = 'Loading PDF parser and extracting text...';

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          this.busy = false;
          this.message = 'Could not read the PDF file.';
          return;
        }

        const pdfjsLib = await this.loadPdfJs();
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdf = await loadingTask.promise;
        const parsedItems: any[] = [];
        let invoiceNoParsed = '';
        let billDateParsed = '';
        let dueDateParsed = '';
        let rawTextCollected = '';
        let diagnostics = `Pages: ${pdf.numPages}`;
        let totalTextItems = 0;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          totalTextItems += textContent.items.length;
          diagnostics += `, P${pageNum}Items: ${textContent.items.length}`;
          rawTextCollected += textContent.items.map((item: any) => item.str).join(' ') + ' ';

          interface ParsedPdfItem {
            text: string;
            x: number;
            y: number;
            height: number;
          }

          const items: ParsedPdfItem[] = textContent.items.map((item: any) => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            height: item.height
          }));

          items.sort((a: ParsedPdfItem, b: ParsedPdfItem) => b.y - a.y);

          const rows: ParsedPdfItem[][] = [];
          let currentRow: ParsedPdfItem[] = [];
          let lastY = -1;

          for (const item of items) {
            if (lastY === -1 || Math.abs(item.y - lastY) < 12) {
              currentRow.push(item);
              if (lastY === -1) lastY = item.y;
            } else {
              currentRow.sort((a: ParsedPdfItem, b: ParsedPdfItem) => a.x - b.x);
              rows.push(currentRow);
              currentRow = [item];
              lastY = item.y;
            }
          }
          if (currentRow.length > 0) {
            currentRow.sort((a: ParsedPdfItem, b: ParsedPdfItem) => a.x - b.x);
            rows.push(currentRow);
          }

          for (const row of rows) {
            const rowText = row.map((item: ParsedPdfItem) => item.text).join(' ');
            const rowTextUpper = rowText.toUpperCase();

            if (rowTextUpper.includes('INVOICE NO') || rowTextUpper.includes('INV NO') || rowTextUpper.includes('INVOICE NUMBER') || rowTextUpper.includes('BILL NO') || rowTextUpper.includes('BILL NUMBER')) {
              const match = rowText.match(/(?:Invoice\s+No\.?|Inv\s+No\.?|Invoice\s+Number|Bill\s+No\.?|Bill\s+Number)\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
              if (match) invoiceNoParsed = match[1];
            }
            if (rowTextUpper.includes('DATE') && !rowTextUpper.includes('DUE') && !rowTextUpper.includes('EXP')) {
              const match = rowText.match(/Date\s*[:\-]?\s*(\d{2}[-\/\.]\d{2}[-\/\.]\d{2,4}|\d{4}[-\/\.]\d{2}[-\/\.]\d{2})/i);
              if (match) billDateParsed = match[1];
            }
            if (rowTextUpper.includes('DUE DATE') || rowTextUpper.includes('DUE DT')) {
              const match = rowText.match(/(?:Due\s+Date|Due\s+Dt)\s*[:\-]?\s*(\d{2}[-\/\.]\d{2}[-\/\.]\d{2,4}|\d{4}[-\/\.]\d{2}[-\/\.]\d{2})/i);
              if (match) dueDateParsed = match[1];
            }
          }

          const headerKeywords = {
            srNo: ['SR', 'SR.', 'SR.NO.', 'SR.NO', 'S.NO', 'S.NO.', 'SNO', 'SL', 'SL.NO', 'SLNO', 'SERIAL', 'S. N.', 'S.N.'],
            hsnCode: ['HSN', 'HSN/SAC', 'HSN CODE', 'HSNCODE', 'SAC', 'HSN CODE.'],
            medicineName: ['DESCRIPTION', 'PRODUCT', 'MEDICINE', 'ITEM', 'PARTICULARS', 'NAME OF PRODUCT', 'NAME OF MEDICINE', 'DRUG', 'PRODUCT NAME'],
            pack: ['PACK', 'PACKING', 'PK', 'PKG', 'BOX', 'UNIT'],
            mfr: ['MFR', 'MFG', 'MANUFACTURER', 'MFR.', 'MFG.', 'MFR BY', 'MFG BY', 'MAKE'],
            batchNo: ['BATCH', 'B.NO', 'B. NO', 'B NO', 'BATCHNO', 'LOT', 'BATCH NUMBER', 'BATCH NO.'],
            expiryDate: ['EXP', 'EXPIRY', 'E.DT', 'EXP.DT', 'E-DT', 'EXPDATE', 'EXPIRY DATE', 'EXP DT'],
            quantity: ['QTY', 'QUANTITY', 'QUANT', 'BILLED QTY', 'QTY.'],
            free: ['FREE', 'SCHEME', 'SCHME', 'SCH', 'FREE QTY', 'SCH QTY'],
            mrp: ['MRP', 'M.R.P.', 'MRP RS.', 'M.R.P'],
            purchasePrice: ['RATE', 'PURCHASE', 'PRICE', 'UNIT COST', 'P.RATE', 'PUR. RATE', 'PUR RATE', 'PTR', 'P.T.R.', 'P.T.R', 'PTS', 'P.T.S.', 'P.T.S', 'TRADE PRICE', 'DIST. RATE', 'PURCHASE RATE', 'PURCHASE PRICE'],
            discountPercentage: ['DIS', 'DISC', 'DIS%', 'DISCOUNT', 'SCH%', 'DISC%', 'DIS. %', 'DIS%.'],
            gstPercentage: ['GST', 'GST%', 'TAX%', 'TAX', 'CGST%', 'SGST%', 'GST %'],
            amount: ['AMOUNT', 'NET AMOUNT', 'TOTAL', 'VALUE', 'NET AMT', 'NETAMOUNT', 'TOTAL AMT']
          };

          let headerRow: ParsedPdfItem[] | null = null;
          let columnMapping: { [key: string]: { xStart: number; xEnd: number } } = {};
          let headerIndex = -1;

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const matchedColumns: { [colKey: string]: ParsedPdfItem } = {};

            for (const item of row) {
              const txt = item.text.trim().toUpperCase();
              for (const [colKey, keywords] of Object.entries(headerKeywords)) {
                const isMatch = keywords.some(k => {
                  if (k.length <= 4) {
                    const regex = new RegExp(`(?:^|\\b)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\b|\\%)`, 'i');
                    return regex.test(txt);
                  }
                  return txt.includes(k);
                });
                if (isMatch) {
                  if (!matchedColumns[colKey]) {
                    matchedColumns[colKey] = item;
                  }
                }
              }
            }

            if (Object.keys(matchedColumns).length >= 3) {
              headerRow = row;
              headerIndex = i;

              const matchedList = Object.entries(matchedColumns).map(([colKey, item]) => ({
                colKey,
                x: item.x
              }));
              matchedList.sort((a, b) => a.x - b.x);

              for (let j = 0; j < matchedList.length; j++) {
                const current = matchedList[j];
                const prev = matchedList[j - 1];
                const next = matchedList[j + 1];

                const xStart = prev ? (prev.x + current.x) / 2 : 0;
                const xEnd = next ? (current.x + next.x) / 2 : 99999;

                columnMapping[current.colKey] = { xStart, xEnd };
              }
              break;
            }
          }

          if (headerRow && headerIndex !== -1) {
            const dataRows = rows.slice(headerIndex + 1);
            for (const row of dataRows) {
              const rowValues: { [colKey: string]: string[] } = {
                srNo: [],
                hsnCode: [],
                medicineName: [],
                pack: [],
                mfr: [],
                batchNo: [],
                expiryDate: [],
                quantity: [],
                free: [],
                mrp: [],
                purchasePrice: [],
                discountPercentage: [],
                gstPercentage: [],
                amount: []
              };

              for (const item of row) {
                for (const [colKey, bounds] of Object.entries(columnMapping)) {
                  if (item.x >= bounds.xStart && item.x < bounds.xEnd) {
                    rowValues[colKey].push(item.text.trim());
                    break;
                  }
                }
              }

              let medicineName = rowValues['medicineName'].join(' ').trim();
              if (medicineName) {
                medicineName = medicineName.replace(/^\d+\s+/, '');
              }
              let manufacturer = rowValues['mfr'].join(' ').trim() || 'Unknown';
              let hsnCode = rowValues['hsnCode'].join(' ').trim() || '300490';
              let category = rowValues['pack'].join(' ').trim() || 'General';

              let batchNo = rowValues['batchNo'].join('').trim() || 'B-NEW';
              const revMatch = batchNo.match(/^(\d+)([A-Z]+[\-\/\_])$/i);
              if (revMatch) {
                batchNo = revMatch[2] + revMatch[1];
              } else {
                const revMatch2 = batchNo.match(/^(\d+)([A-Z]+)$/i);
                if (revMatch2) {
                  batchNo = revMatch2[2] + '-' + revMatch2[1];
                }
              }

              let expiryDateRaw = rowValues['expiryDate'].join('').trim();
              let expiryDate = '';
              const dateRegex = /^(0[1-9]|1[0-2])[\-\/\u2013\u2014\\_](20\d{2}|\d{2})$/;
              if (dateRegex.test(expiryDateRaw)) {
                const dateBits = expiryDateRaw.split(/[\-\/\u2013\u2014\\_]/);
                const mm = dateBits[0].padStart(2, '0');
                const yy = dateBits[1];
                const yyyy = yy.length === 2 ? '20' + yy : yy;
                expiryDate = `${yyyy}-${mm}-28`;
              } else if (/^\d{4}-\d{2}-\d{2}$/.test(expiryDateRaw)) {
                expiryDate = expiryDateRaw;
              } else {
                expiryDate = getLocalIsoDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
              }
              const quantityRaw = rowValues['quantity'].join('').trim();
              const freeRaw = rowValues['free'].join('').trim();
              const mrpRaw = rowValues['mrp'].join('').trim();
              const purchasePriceRaw = rowValues['purchasePrice'].join('').trim();

              let quantity = parseInt(quantityRaw, 10) || 0;
              let free = parseInt(freeRaw, 10) || 0;
              let mrp = parseFloat(mrpRaw.replace(/,/g, '')) || 0;
              let purchasePrice = parseFloat(purchasePriceRaw.replace(/,/g, '')) || 0;
              let discountPercentage = parseFloat(rowValues['discountPercentage'].join('').replace(/,/g, '')) || 0;
              let gstPercentage = parseFloat(rowValues['gstPercentage'].join('').replace(/%/g, '')) || 12;

              if (!/\d/.test(quantityRaw) && !/\d/.test(freeRaw) && !/\d/.test(mrpRaw) && !/\d/.test(purchasePriceRaw)) {
                continue;
              }

              if (medicineName && !this.isMedicineNameJunk(medicineName)) {
                if (quantity === 0) quantity = 10;
                if (purchasePrice === 0) purchasePrice = mrp ? mrp * 0.7 : 10.00;
                if (mrp === 0) mrp = purchasePrice * 1.25;

                let cleanedName = medicineName.trim();
                cleanedName = cleanedName.replace(/^\d+[\s\-\/\.]*/, '').trim();
                if (!cleanedName) cleanedName = medicineName.trim();

                let medicineCode = 'MED-' + cleanedName.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 12);

                const matchedMed = this.medicines.find(m => {
                  const dbName = m.name.toLowerCase().trim();
                  const parsedName = cleanedName.toLowerCase().trim();
                  return parsedName === dbName || parsedName.includes(dbName) || dbName.includes(parsedName);
                });

                let billMrp = mrp || (matchedMed ? matchedMed.mrp : 0);
                let sellingPrice = billMrp;
                if (discountPercentage > 0) {
                  sellingPrice = Number((billMrp * (1 - discountPercentage / 100)).toFixed(2));
                }
                mrp = billMrp;

                if (matchedMed) {
                  medicineCode = matchedMed.code;
                  medicineName = matchedMed.name;
                  if (!gstPercentage || gstPercentage === 12) {
                    gstPercentage = matchedMed.gstPercentage || 12;
                  }
                  if ((!manufacturer || manufacturer === 'Unknown') && matchedMed.manufacturer) {
                    manufacturer = matchedMed.manufacturer;
                  }
                  if ((!hsnCode || hsnCode === '300490') && matchedMed.hsnCode) {
                    hsnCode = matchedMed.hsnCode;
                  }
                  if ((!category || category === 'General') && matchedMed.category) {
                    category = matchedMed.category;
                  }
                } else {
                  medicineName = cleanedName;
                }

                const sellingDiscountPercent = mrp ? Math.max(0, Number(((mrp - sellingPrice) / mrp * 100).toFixed(2))) : 0;
                parsedItems.push({
                  medicineCode,
                  medicineName,
                  manufacturer,
                  hsnCode,
                  category,
                  batchNo,
                  expiryDate,
                  quantity,
                  free,
                  purchasePrice,
                  mrp,
                  discountPercentage,
                  gstPercentage,
                  sellingPrice,
                  sellingDiscountPercent
                });
              }
            }
          } else {
            for (const row of rows) {
              const rowText = row.map((item: ParsedPdfItem) => item.text).join(' ');
              const item = this.parseSingleBillTextLine(rowText);
              if (item) {
                parsedItems.push(item);
              }
            }
          }
        }

        parsedItems.push(...this.extractItemsFromText(rawTextCollected));
        let metadata = {
          billNo: invoiceNoParsed,
          billDate: billDateParsed,
          dueDate: dueDateParsed
        };
        const metadataFromText = this.extractBillMetadata(rawTextCollected);
        metadata = {
          billNo: metadata.billNo || metadataFromText.billNo,
          billDate: metadata.billDate || metadataFromText.billDate,
          dueDate: metadata.dueDate || metadataFromText.dueDate
        };

        if (parsedItems.length === 0) {
          try {
            this.message = 'PDF has no readable bill table. Scanning PDF pages with OCR...';
            const Tesseract = await this.loadTesseract();
            let ocrText = '';
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
              const page = await pdf.getPage(pageNum);
              const pageImage = await this.renderPdfPageToOcrDataUrl(page);
              const ocrResult = await Tesseract.recognize(pageImage, 'eng', this.billOcrOptions('6'));
              ocrText += '\n' + (ocrResult?.data?.text || '');
              parsedItems.push(...this.extractItemsFromOcrResult(ocrResult));
            }
            const metadataFromOcr = this.extractBillMetadata(ocrText);
            metadata = {
              billNo: metadata.billNo || metadataFromOcr.billNo,
              billDate: metadata.billDate || metadataFromOcr.billDate,
              dueDate: metadata.dueDate || metadataFromOcr.dueDate
            };
          } catch (ocrErr) {
            console.warn('PDF OCR fallback failed', ocrErr);
          }
        }

        const uniqueParsedItems = this.mergeParsedItems(parsedItems);
        parsedItems.splice(0, parsedItems.length, ...uniqueParsedItems);

        if (parsedItems.length === 0) {
          parsedItems.push({
            medicineCode: 'MED-NEW',
            medicineName: 'New Medicine',
            manufacturer: 'Unknown',
            hsnCode: '300490',
            category: 'General',
            batchNo: 'B-NEW',
            expiryDate: getLocalIsoDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)),
            quantity: 10,
            free: 0,
            purchasePrice: 10.00,
            mrp: 15.00,
            discountPercentage: 0,
            gstPercentage: 12,
            sellingPrice: 15.00,
            sellingDiscountPercent: 0
          });

          if (totalTextItems === 0) {
            this.message = 'This PDF file appears to be a scanned image (0 text items found). Processing OCR or manual entry...';
          } else {
            this.message = `Could not extract items automatically from the PDF layout (Diag: ${diagnostics}). Added a manual row for you to edit.`;
          }
        } else {
          this.message = `Successfully loaded ${parsedItems.length} items from PDF. Please review and save.`;
        }

        const normalizeMetaDate = (dStr: string): string => {
          if (!dStr) return '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
          const match = dStr.match(/^(\d{2,4})[-\/\.](\d{2})[-\/\.](\d{2,4})$/);
          if (match) {
            const yyyy = match[3].length === 2 ? '20' + match[3] : match[3];
            return `${yyyy}-${match[2]}-${match[1]}`;
          }
          return dStr;
        };

        this.uploadedItems = parsedItems;
        const parsedBillNo = metadata.billNo || file.name.substring(0, file.name.lastIndexOf('.')).toUpperCase() || 'BILL-' + Math.floor(Math.random() * 10000);
        this.bulkBillForm = {
          distributorId: distributorId,
          billNo: parsedBillNo,
          billDate: normalizeMetaDate(metadata.billDate) || getLocalIsoDate(),
          dueDate: normalizeMetaDate(metadata.dueDate) || getLocalIsoDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
        };

        const dist = this.distributors.find(d => d.id === distributorId);
        const isDuplicate = (this.distributorBillsHistory || []).some(b => 
          dist && b.distributorName?.trim().toLowerCase() === dist.name.trim().toLowerCase() && b.billNo?.trim().toLowerCase() === parsedBillNo.trim().toLowerCase()
        ) || (this.distributorBillsList || []).some(b => 
          dist && b.distributorName?.trim().toLowerCase() === dist.name.trim().toLowerCase() && b.billNo?.trim().toLowerCase() === parsedBillNo.trim().toLowerCase()
        );
        if (isDuplicate) {
          this.message = `⚠️ Warning: Bill #${parsedBillNo} from distributor "${dist?.name}" has already been uploaded previously. Uploading it again will be rejected as duplicate.`;
        }

        if (this.view !== 'bulk-upload') {
          this.viewHistory.push(this.view);
        }
        this.view = 'bulk-upload';
        this.busy = false;
        input.value = '';
      } catch (err: any) {
        this.busy = false;
        this.message = 'Error parsing PDF file: ' + (err.message || err);
        input.value = '';
      }
    };

    reader.onerror = () => {
      this.busy = false;
      this.message = 'Failed to read the file.';
    };

    reader.readAsArrayBuffer(file);
  }

  private async renderPdfPageToOcrDataUrl(page: any): Promise<string> {
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not prepare PDF page for OCR.');
    }
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return this.enhanceCanvasToDataUrl(canvas);
  }

  private isHeaderOrFooterJunkLine(line: string): boolean {
    if (!line) return true;
    const upper = line.trim().toUpperCase();

    const junkKeywords = [
      'SUJATHA MEDICAL', 'MEDICAL AGENCIES', 'THATAKULAVARI', 'VIJAYAWADA',
      'PH:', 'PHONE', 'GST INVOICE', 'GSTIN', 'DL NO', 'DL.NO', 'DL NO1', 'DL NO2',
      'HPR NO', 'HFR NO', 'ADR NO', 'INV NO', 'INVOICE NO', 'BILL TYPE', 'CREDIT',
      'LAKSHMI MEDICAL', 'MAKKAPETA', 'CUSTOMER', 'PLACE OF SUPPLY', 'TERMS',
      'TOTAL DUE', 'SUB TOTAL', 'LESS DISC', 'GST AMT', 'NET PAYABLE', 'TAXABLE',
      'CGST', 'SGST', 'ROUNDING', 'IN WORDS', 'AUTHORISED', 'SIGNATORY', 'BANK :',
      'GOODS SUPPLIED', 'JURISDICTION', 'MFG HSN CODE', 'PRODUCT NAME', 'BATCH NO EXPIRY'
    ];

    for (const kw of junkKeywords) {
      if (upper.includes(kw)) return true;
    }

    return false;
  }

  private finishBillUpload(
    parsedItems: any[],
    distributorId?: number,
    fileName?: string,
    metadata: { billNo?: string; billDate?: string; dueDate?: string } = {},
    sourceLabel = 'bill'
  ): void {
    const normalizeMetaDate = (dStr: string | undefined): string => {
      if (!dStr) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
      const match = dStr.match(/^(\d{2,4})[-\/\.](\d{2})[-\/\.](\d{2,4})$/);
      if (match) {
        const yyyy = match[3].length === 2 ? '20' + match[3] : match[3];
        return `${yyyy}-${match[2]}-${match[1]}`;
      }
      return dStr;
    };

    this.uploadedItems = this.mergeParsedItems(parsedItems);
    this.bulkBillForm = {
      distributorId: distributorId || 0,
      billNo: metadata.billNo || (fileName ? fileName.substring(0, fileName.lastIndexOf('.')).toUpperCase() : 'BILL-' + Math.floor(Math.random() * 10000)),
      billDate: normalizeMetaDate(metadata.billDate) || getLocalIsoDate(),
      dueDate: normalizeMetaDate(metadata.dueDate) || getLocalIsoDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
    };

    this.message = `Successfully scanned ${this.uploadedItems.length} items from ${sourceLabel}. Please review and save.`;

    if (this.view !== 'bulk-upload') {
      this.viewHistory.push(this.view);
    }
    this.view = 'bulk-upload';
    this.busy = false;
  }

  processBillTextContent(text: string, distributorId?: number, fileName?: string): void {
    console.log('🔥 BILL PARSER ENGINE V2.0 ACTIVE 🔥');
    const metadata = this.extractBillMetadata(text);
    const parsedItems: any[] = this.extractItemsFromText(text);

    if (parsedItems.length === 0) {
      this.message = 'Could not extract items automatically from bill text/image. Added a manual row for you to edit.';
      parsedItems.push({
        medicineCode: 'MED-NEW',
        medicineName: 'New Medicine',
        manufacturer: 'Unknown',
        hsnCode: '300490',
        category: 'General',
        batchNo: 'B-NEW',
        expiryDate: getLocalIsoDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)),
        quantity: 10,
        free: 0,
        purchasePrice: 10.00,
        mrp: 15.00,
        discountPercentage: 0,
        gstPercentage: 12,
        sellingPrice: 15.00,
        sellingDiscountPercent: 0
      });
    } else {
      this.finishBillUpload(parsedItems, distributorId, fileName, metadata, 'bill');
      return;
    }

    const normalizeMetaDate = (dStr: string): string => {
      if (!dStr) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
      const match = dStr.match(/^(\d{2,4})[-\/\.](\d{2})[-\/\.](\d{2,4})$/);
      if (match) {
        const yyyy = match[3].length === 2 ? '20' + match[3] : match[3];
        return `${yyyy}-${match[2]}-${match[1]}`;
      }
      return dStr;
    };

    this.uploadedItems = parsedItems;
    this.bulkBillForm = {
      distributorId: distributorId || 0,
      billNo: metadata.billNo || (fileName ? fileName.substring(0, fileName.lastIndexOf('.')).toUpperCase() : 'BILL-' + Math.floor(Math.random() * 10000)),
      billDate: normalizeMetaDate(metadata.billDate || '') || getLocalIsoDate(),
      dueDate: normalizeMetaDate(metadata.dueDate || '') || getLocalIsoDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
    };

    if (this.view !== 'bulk-upload') {
      this.viewHistory.push(this.view);
    }
    this.view = 'bulk-upload';
    this.busy = false;
  }

  parseSingleBillTextLine(line: string): any | null {
    let trimmed = line.trim();
    if (!trimmed) return null;
    if (this.isHeaderOrFooterJunkLine(trimmed)) return null;
    if (/\bAP\/\d+|\bDL\s*NO|\bLICENSE|\bHPR\s*NO|\bHFR\s*NO|\bADR\s*NO/i.test(trimmed)) return null;

    // Clean leading OCR margin artifacts like "i ", "1 ", "| "
    trimmed = trimmed.replace(/^[iI1\|\.\,\s]+\s+(?=[A-Za-z])/i, '');

    // Expiry date regex: matches valid medicine expiry month 01-12 and year (accepts OCR separators like /, -, ., l, I, |, spaces)
    const dateRegex = /(0[1-9]|1[0-2])[\-\/\u2013\u2014\\_\s\.\,lIi|]+(20[2-3][0-9]|[2-3][0-9])\b/;
    const dateMatch = trimmed.match(dateRegex);
    if (!dateMatch) return null;

    const expiryDateRaw = dateMatch[0].trim();
    const rawDateBits = expiryDateRaw.split(/[\-\/\u2013\u2014\\_\s\.\,lIi|]+/);
    if (rawDateBits.length < 2) return null;
    let expYear = parseInt(rawDateBits[1], 10);
    if (expYear < 100) expYear += 2000;

    // Medicine expiry MUST be in the future (>= 2026). Reject past DL / registration dates (like 2023, 2022)
    const currentYear = new Date().getFullYear();
    if (expYear < currentYear || expYear > currentYear + 15) return null;

    const dateIdx = trimmed.indexOf(expiryDateRaw);
    const beforeDate = trimmed.substring(0, dateIdx).trim();
    const afterDate = trimmed.substring(dateIdx + expiryDateRaw.length).trim();

    const beforeParts = beforeDate.split(/\s+/).filter(Boolean);
    if (beforeParts.length < 2) return null;

    let batchNo = beforeParts[beforeParts.length - 1];
    const revMatch = batchNo.match(/^(\d+)([A-Z]+[\-\/\_])$/i);
    if (revMatch) {
      batchNo = revMatch[2] + revMatch[1];
    } else {
      const revMatch2 = batchNo.match(/^(\d+)([A-Z]+)$/i);
      if (revMatch2) {
        batchNo = revMatch2[2] + '-' + revMatch2[1];
      }
    }

    let tokens = beforeParts.slice(0, beforeParts.length - 1);

    if (tokens.length > 0 && /^\d{1,2}$/.test(tokens[0])) {
      tokens.shift();
    }

    let manufacturer = 'Unknown';
    let hsnCode = '300490';

    // 1. Check for concatenated Mfg & HSN (e.g. BIOCHE30049083, SEMUNS90211000, MICRO30049069, iBIOCHE30049083)
    if (tokens.length >= 1) {
      const cleanedToken = tokens[0].replace(/^[iI1]+(?=[A-Za-z]{3,})/i, '');
      const concatMatch = cleanedToken.match(/^([A-Za-z]{2,8})(\d{4,8})$/i);
      if (concatMatch) {
        manufacturer = concatMatch[1];
        hsnCode = concatMatch[2];
        tokens = tokens.slice(1);
      }
    }

    if (manufacturer === 'Unknown' && tokens.length >= 2 && /^[A-Za-z]{3,}$/.test(tokens[0]) && /^\d{4,8}$/.test(tokens[1])) {
      manufacturer = tokens[0];
      hsnCode = tokens[1];
      tokens = tokens.slice(2);
    } else if (hsnCode === '300490' && tokens.length >= 1 && /^\d{4,8}$/.test(tokens[0])) {
      hsnCode = tokens[0];
      tokens = tokens.slice(1);
    }

    if (manufacturer.toUpperCase() === 'BIOCHI') manufacturer = 'BIOCHE';
    if (hsnCode === '0049083' || hsnCode === '049083') hsnCode = '30049083';

    let category = 'General';
    let medicineName = '';

    const packRegex = /^(?:\d+\s*)?(?:3ml|5ml|10ml|100ml|50ml|2ml|10s|10's|10ta|10tab|10cap|10caps|10gm|15gm|100mg|500mg|each|s|m|l|xl|1x10|10x10|1amp|ta|tab|tabs|cap|caps|gm|ml|mg|pcs|nos|vial|amp)$/i;

    if (tokens.length >= 2) {
      const lastToken = tokens[tokens.length - 1].trim();
      const prevToken = tokens[tokens.length - 2].trim();
      const combined = (prevToken + ' ' + lastToken).trim();

      if (/^\d+\s*(?:TA|TAB|TABS|CAP|CAPS|GM|ML|MG|S|NOS|PCS|VIAL|AMP)$/i.test(combined)) {
        category = combined;
        medicineName = tokens.slice(0, tokens.length - 2).join(' ');
      } else if (packRegex.test(lastToken)) {
        if (/^\d+$/.test(prevToken)) {
          category = prevToken + ' ' + lastToken;
          medicineName = tokens.slice(0, tokens.length - 2).join(' ');
        } else {
          category = lastToken;
          medicineName = tokens.slice(0, tokens.length - 1).join(' ');
        }
      } else if (/^(?:TA|TAB|TABS|CAP|CAPS|GM|ML|MG|S|NOS|PCS)$/i.test(lastToken)) {
        const numMatch = prevToken.match(/(\d+)$/);
        if (numMatch) {
          category = numMatch[1] + ' ' + lastToken;
          tokens[tokens.length - 2] = prevToken.substring(0, prevToken.length - numMatch[1].length).trim();
          medicineName = tokens.slice(0, tokens.length - 1).join(' ');
        } else {
          category = lastToken;
          medicineName = tokens.slice(0, tokens.length - 1).join(' ');
        }
      } else {
        medicineName = tokens.join(' ');
      }
    } else if (tokens.length === 1) {
      if (packRegex.test(tokens[0])) {
        category = tokens[0];
      } else {
        medicineName = tokens[0];
      }
    }

    if (category === 'General' || /^(?:TA|TAB|TABS|CAP|CAPS|GM|ML|MG|S|NOS|PCS)$/i.test(category)) {
      const numInName = medicineName.match(/(\d+)\s*$/);
      if (numInName) {
        const unit = category !== 'General' ? category : 'TA';
        category = numInName[1] + ' ' + unit.toUpperCase();
        medicineName = medicineName.substring(0, medicineName.length - numInName[0].length).trim();
      } else if (category !== 'General') {
        category = '10 ' + category.toUpperCase();
      }
    }

    medicineName = medicineName.replace(/^\d+[\s\-\/\.]*/, '').trim();
    if (!medicineName) return null;
    if (this.isMedicineNameJunk(medicineName)) return null;

    const mm = rawDateBits[0].padStart(2, '0');
    const expiryDate = `${expYear}-${mm}-28`;

    const afterParts = afterDate.split(/\s+/).filter(Boolean);
    let quantity = 0;
    let free = 0;
    let mrp = 0;
    let purchasePrice = 0;
    let discountPercentage = 0;
    let gstPercentage = 12;

    const nums = afterParts.map(p => parseFloat(p.replace(/,/g, '').replace('%', ''))).filter(n => !isNaN(n));

    if (nums.length >= 5) {
      mrp = nums[0];
      quantity = Math.round(nums[1]);
      free = Math.round(nums[2]) || 0;
      purchasePrice = nums[3];
      if (mrp > 0 && purchasePrice > mrp * 2) {
        purchasePrice = purchasePrice / 100;
      }
      gstPercentage = nums[5] || 5;
    } else if (nums.length === 4) {
      quantity = Math.round(nums[0]);
      mrp = nums[1];
      purchasePrice = nums[2];
      if (mrp > 0 && purchasePrice > mrp * 2) {
        purchasePrice = purchasePrice / 100;
      }
      gstPercentage = nums[3] || 12;
    } else if (nums.length >= 2) {
      quantity = Math.round(nums[0]) || 10;
      mrp = nums[1] || 10;
      purchasePrice = nums[2] || mrp * 0.7;
      if (mrp > 0 && purchasePrice > mrp * 2) {
        purchasePrice = purchasePrice / 100;
      }
    }

    if (quantity <= 0) quantity = 10;
    if (purchasePrice <= 0) purchasePrice = mrp ? mrp * 0.7 : 10.00;
    if (mrp <= 0) mrp = purchasePrice * 1.25;

    let medicineCode = 'MED-' + medicineName.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 12);
    const matchedMed = this.medicines.find(m => {
      const dbName = m.name.toLowerCase().trim();
      const parsedName = medicineName.toLowerCase().trim();
      return parsedName === dbName || parsedName.includes(dbName) || dbName.includes(parsedName);
    });

    let sellingPrice = mrp;
    if (matchedMed) {
      medicineCode = matchedMed.code;
      medicineName = matchedMed.name;
      sellingPrice = matchedMed.sellingPrice;
      mrp = matchedMed.mrp;
      gstPercentage = matchedMed.gstPercentage;
      if ((!manufacturer || manufacturer === 'Unknown') && matchedMed.manufacturer) {
        manufacturer = matchedMed.manufacturer;
      }
      if ((!hsnCode || hsnCode === '300490') && matchedMed.hsnCode) {
        hsnCode = matchedMed.hsnCode;
      }
      if ((!category || category === 'General') && matchedMed.category) {
        category = matchedMed.category;
      }
    }

    const sellingDiscountPercent = mrp ? Math.max(0, Number(((mrp - sellingPrice) / mrp * 100).toFixed(2))) : 0;

    return {
      medicineCode,
      medicineName,
      manufacturer,
      hsnCode,
      category,
      batchNo,
      expiryDate,
      quantity,
      free,
      purchasePrice,
      mrp,
      discountPercentage,
      gstPercentage,
      sellingPrice,
      sellingDiscountPercent
    };
  }

  pastedBillText = '';

  parsePastedText(distributorId: number | undefined): void {
    if (!this.pastedBillText.trim()) {
      this.message = 'Please paste some text to parse.';
      return;
    }
    if (!distributorId) {
      this.message = 'Please select a distributor first.';
      return;
    }

    this.busy = true;
    this.message = 'Parsing pasted text...';

    try {
      this.processBillTextContent(this.pastedBillText, distributorId);
      this.pastedBillText = '';
    } catch (e: any) {
      this.message = 'Error parsing pasted text: ' + (e.message || e);
      this.busy = false;
    }
  }

  private isMedicineNameJunk(name: string): boolean {
    if (!name) return true;
    const upper = name.trim().toUpperCase();

    // Blacklist keywords
    const blacklist = [
      'AC. NO', 'ACCOUNT NO', 'ACC NO', 'A/C NO', 'IFSC', 'SBIN', 'SWIFT', 'IBAN',
      'TERMS', 'CONDITIONS', 'SUBJECT TO', 'VADODARA', 'JURISDICTION', 'COURT',
      'DELIVERY', 'ADVANCE PAYMENT', 'PAYMENT BEFORE', 'FOR APEX', 'AUTHORISED',
      'SIGNATORY', 'SIGNATURE', 'PREPARED BY', 'CHECKED BY', 'RECEIVED BY',
      'RUPEES', 'AMOUNT IN WORDS', 'E. & O.E.', 'E&OE', 'GSTIN', 'GST NO', 'PAN NO',
      'CIN NO', 'DRUG LICENSE', 'DL NO', 'DL. NO', '127.0.0.1', 'LOCALHOST',
      'HTTP://', 'HTTPS://', 'WWW.', 'PAGE ', 'INVOICE', 'INV NO', 'BILL NO',
      'DATE', 'DUE DATE', 'ROUND OFF', 'GST SUMMARY', 'SUB TOTAL', 'SUBTOTAL',
      'GRAND TOTAL', 'TOTAL AMOUNT', 'CGST', 'SGST', 'IGST', 'TAXABLE VALUE',
      'TAX AMOUNT', 'TOTAL TAX', 'DISCOUNT', 'SCHEME', 'FREE QTY', 'BANK DETAILS',
      'STATE BANK', 'HDFC', 'ICICI', 'AXIS', 'BENEFICIARY', 'BRANCH', 'TOTALS',
      'INDIA', 'GUJARAT', 'COUNTRY OF ORIGIN', 'STATE'
    ];

    if (blacklist.some(keyword => upper.includes(keyword))) {
      return true;
    }

    // If the name is just a number (e.g. HSN codes like "300490")
    if (/^\d+$/.test(upper.replace(/[\s\-\/\.]/g, ''))) {
      return true;
    }

    // If the name is just an IFSC code or GSTIN pattern (alphanumeric without space, length 8-16)
    const cleaned = upper.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length >= 8 && cleaned.length <= 16) {
      // Check if it's a single word (no spaces in original)
      if (!name.trim().includes(' ')) {
        // Check if it contains both letters and numbers
        if (/[A-Z]/.test(cleaned) && /[0-9]/.test(cleaned)) {
          return true;
        }
      }
    }

    // Very short name
    if (name.trim().length <= 2) {
      return true;
    }

    return false;
  }

  private loadPdfJs(): Promise<any> {
    if ((window as any).pdfjsLib) {
      return Promise.resolve((window as any).pdfjsLib);
    }
    return new Promise((resolve, reject) => {
      // 1. Load pdf.min.js
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.onload = () => {
        // 2. Load pdf.worker.min.js in the main thread (fallback for when workers are restricted/sandboxed)
        const workerScript = document.createElement('script');
        workerScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        workerScript.onload = () => {
          const pdfjsLib = (window as any).pdfjsLib;
          // Set workerSrc to empty to force fake worker using the already loaded worker script,
          // which avoids any web worker same-origin policy errors entirely.
          pdfjsLib.GlobalWorkerOptions.workerSrc = '';
          resolve(pdfjsLib);
        };
        workerScript.onerror = reject;
        document.head.appendChild(workerScript);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  removeUploadedItem(index: number): void {
    if (index >= 0 && index < this.uploadedItems.length) {
      const removed = this.uploadedItems.splice(index, 1);
      this.message = `Removed "${removed[0]?.medicineName || 'item'}" from bill preview.`;
    }
  }

  deleteDistributorBill(bill: DistributorBillView): void {
    if (!bill) return;
    const confirmDel = confirm(`Are you sure you want to delete distributor purchase bill "${bill.billNo}" (${bill.distributorName})? This will remove the bill record and associated inventory batches.`);
    if (!confirmDel) return;

    this.busy = true;
    this.api.deleteDistributorBill(bill.id).subscribe({
      next: () => {
        this.busy = false;
        this.message = `Successfully deleted distributor bill ${bill.billNo}.`;
        this.reload();
      },
      error: err => {
        this.busy = false;
        this.fail(err);
      }
    });
  }

  saveBulkBill(): void {
    // Validate inputs
    const billNoClean = this.bulkBillForm.billNo.trim();
    if (!billNoClean) {
      this.message = 'Please enter a valid Bill Number.';
      return;
    }
    if (!this.bulkBillForm.billDate) {
      this.message = 'Please enter a valid Bill Date.';
      return;
    }
    if (!this.bulkBillForm.dueDate) {
      this.message = 'Please enter a valid Due Date.';
      return;
    }

    const dist = this.distributors.find(d => d.id === this.bulkBillForm.distributorId);
    const isDuplicate = (this.distributorBillsHistory || []).some(b => 
      dist && b.distributorName?.trim().toLowerCase() === dist.name.trim().toLowerCase() && b.billNo?.trim().toLowerCase() === billNoClean.toLowerCase()
    ) || (this.distributorBillsList || []).some(b => 
      dist && b.distributorName?.trim().toLowerCase() === dist.name.trim().toLowerCase() && b.billNo?.trim().toLowerCase() === billNoClean.toLowerCase()
    );

    if (isDuplicate) {
      this.message = `Duplicate Error: Bill #${billNoClean} from distributor "${dist?.name}" has already been uploaded/present in the system. Duplicate bill uploads are not allowed.`;
      return;
    }

    // Validate items
    for (const item of this.uploadedItems) {
      if (!item.genericName || !item.genericName.trim()) {
        item.compositionError = true;
        this.message = `Composition is mandatory! Please enter or search composition for medicine: ${item.medicineName || item.medicineCode}.`;
        return;
      } else {
        item.compositionError = false;
      }
      if (!item.batchNo.trim()) {
        this.message = `Item with code ${item.medicineCode} has an empty Batch Number.`;
        return;
      }
      if (!item.expiryDate) {
        this.message = `Item with code ${item.medicineCode} has an empty Expiry Date.`;
        return;
      }
      if (item.quantity <= 0) {
        this.message = `Item ${item.medicineCode} must have a quantity greater than 0.`;
        return;
      }
      if (item.purchasePrice <= 0) {
        this.message = `Item ${item.medicineCode} must have a purchase price greater than 0.`;
        return;
      }
      if (item.mrp <= 0) {
        this.message = `Item ${item.medicineCode} must have an MRP greater than 0.`;
        return;
      }
      if (item.sellingPrice <= 0) {
        this.message = `Please enter a valid Selling Price (greater than 0) for ${item.medicineName || item.medicineCode}.`;
        return;
      }
      if (item.sellingPrice > item.mrp) {
        this.message = `Selling Price cannot exceed MRP for ${item.medicineName || item.medicineCode}.`;
        return;
      }
    }

    this.showConfirm(
      `Are you sure you want to save this bulk purchase invoice with ${this.uploadedItems.length} items?`,
      () => this.submitBulkBillPayload(),
      'Save Bulk Purchase'
    );
  }

  private submitBulkBillPayload(): void {
    const payload = {
      distributorId: this.bulkBillForm.distributorId,
      billNo: this.bulkBillForm.billNo.trim(),
      billDate: this.bulkBillForm.billDate,
      dueDate: this.bulkBillForm.dueDate,
      items: this.uploadedItems.map(item => ({
        medicineCode: item.medicineCode.trim(),
        medicineName: item.medicineName.trim(),
        genericName: item.genericName ? item.genericName.trim() : 'Generic',
        manufacturer: item.manufacturer ? item.manufacturer.trim() : 'Unknown',
        hsnCode: item.hsnCode ? item.hsnCode.trim() : '300490',
        category: item.category ? item.category.trim() : 'General',
        batchNo: item.batchNo.trim(),
        expiryDate: item.expiryDate,
        purchasePrice: item.purchasePrice,
        sellingPrice: item.sellingPrice,
        quantity: item.quantity,
        free: item.free || 0,
        mrp: item.mrp,
        discountPercentage: item.discountPercentage || 0,
        gstPercentage: item.gstPercentage,
        sideEffects: item.sideEffects || ''
      }))
    };

    this.busy = true;
    this.api.uploadBulkBill(payload).subscribe({
      next: (bill) => {
        this.message = `Bulk distributor bill ${bill.billNo} posted successfully! Inventory auto-populated.`;
        this.uploadedItems = [];
        this.reload();

        // Find distributor to show ledger
        const dist = this.distributors.find(d => d.id === this.bulkBillForm.distributorId);
        if (dist) {
          this.selectedDistributor = dist;
          this.ledgerTab = 'credit';
          this.show('distributor-ledger', false);
          this.loadDistributorLedgerData();
        } else {
          this.show('distributors');
        }
      },
      error: error => this.fail(error)
    });
  }

  postDistributorPayment(bill?: DistributorBillView): void {
    if (!this.selectedDistributor) return;
    const selectedBillId = bill ? bill.id : this.distributorPaymentForm.billId;
    const targetBill = this.distributorBillsList.find(b => b.id === selectedBillId);

    if (!targetBill) {
      this.message = 'Please select a valid bill.';
      return;
    }

    const amount = this.distributorPaymentForm.amount || targetBill.dueAmount;
    if (amount <= 0) {
      this.message = 'Please enter a valid payment amount.';
      return;
    }
    if (amount > targetBill.dueAmount) {
      this.message = `Payment amount cannot exceed the balance due (₹${targetBill.dueAmount}).`;
      return;
    }

    const mode = bill ? 'UPI' : this.distributorPaymentForm.paymentMode;
    if (mode === 'UPI') {
      this.openUpiPaymentModal(targetBill, amount);
      return;
    }

    this.showConfirm(
      `Are you sure you want to record a distributor payment of ₹${amount} via ${mode}?`,
      () => this.submitDistributorPaymentPayload(targetBill, amount, mode),
      'Record Distributor Payment'
    );
  }

  private submitDistributorPaymentPayload(targetBill: any, amount: number, mode: string): void {
    if (!this.selectedDistributor) return;
    const payload = {
      distributorId: this.selectedDistributor.id,
      billId: targetBill.id,
      amount: amount,
      paymentMode: mode,
      referenceNo: this.distributorPaymentForm.referenceNo
    };
    this.busy = true;
    this.api.payDistributorBill(payload).subscribe({
      next: () => {
        this.message = 'Payment posted successfully.';
        this.distributorPaymentForm = { billId: 0, amount: 0, paymentMode: 'UPI', referenceNo: '' };
        this.loadDistributorLedgerData();
      },
      error: error => this.fail(error)
    });
  }

  openUpiPaymentModal(bill: DistributorBillView, amount?: number): void {
    if (!this.selectedDistributor) return;
    this.selectedPaymentBill = bill;
    this.upiPaymentAmount = amount || bill.dueAmount;
    this.upiPaymentReference = '';

    if (this.selectedDistributor.upiId) {
      this.showUpiPaymentModal = true;
      this.message = '';
    } else {
      this.message = `Cannot pay via UPI. Please enter and save a UPI ID for ${this.selectedDistributor.name} first.`;
    }
  }

  closeUpiPaymentModal(): void {
    this.showUpiPaymentModal = false;
    this.selectedPaymentBill = undefined;
    this.upiPaymentAmount = 0;
    this.upiPaymentReference = '';
  }

  submitUpiPayment(): void {
    if (!this.selectedPaymentBill || !this.selectedDistributor) return;
    if (!this.upiPaymentAmount || this.upiPaymentAmount <= 0) {
      this.message = 'Please enter a valid payment amount greater than 0.';
      return;
    }
    if (this.upiPaymentAmount > this.selectedPaymentBill.dueAmount) {
      this.message = `Payment amount cannot exceed the balance due (₹${this.selectedPaymentBill.dueAmount}).`;
      return;
    }
    this.showConfirm(
      `Confirm UPI payment of ₹${this.upiPaymentAmount} has been completed on your mobile device?`,
      () => this.submitUpiPaymentPayload(),
      'Confirm UPI Payment'
    );
  }

  private submitUpiPaymentPayload(): void {
    if (!this.selectedPaymentBill || !this.selectedDistributor) return;
    const payload = {
      distributorId: this.selectedDistributor.id,
      billId: this.selectedPaymentBill.id,
      amount: this.upiPaymentAmount,
      paymentMode: 'UPI',
      referenceNo: this.upiPaymentReference
    };
    this.busy = true;
    this.api.payDistributorBill(payload).subscribe({
      next: () => {
        this.message = `UPI Payment of ₹${this.upiPaymentAmount} posted successfully against ${this.selectedPaymentBill?.billNo}.`;
        this.showUpiPaymentModal = false;
        this.distributorPaymentForm = { billId: 0, amount: 0, paymentMode: 'UPI', referenceNo: '' };
        this.loadDistributorLedgerData();
      },
      error: error => this.fail(error)
    });
  }

  getUpiQrCodeUrl(): string {
    if (!this.selectedDistributor || !this.selectedPaymentBill) return '';
    const upiId = this.selectedDistributor.upiId || '';
    const name = encodeURIComponent(this.selectedDistributor.name);
    const amount = this.upiPaymentAmount;
    const note = encodeURIComponent(`Bill ${this.selectedPaymentBill.billNo}`);
    let upiLink = `upi://pay?pa=${upiId}&pn=${name}&cu=INR&tn=${note}`;
    if (amount && amount > 0) {
      upiLink += `&am=${amount}`;
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiLink)}`;
  }

  getOpenDistributorBills(): DistributorBillView[] {
    return this.distributorBillsList.filter(b => b.status === 'OPEN' || Number(b.dueAmount) > 0);
  }

  onBillSelect(): void {
    const selectedBill = this.distributorBillsList.find(b => b.id === this.distributorPaymentForm.billId);
    if (selectedBill) {
      this.distributorPaymentForm.amount = selectedBill.dueAmount;
    }
  }

  getDistributorTotalPurchases(): number {
    return this.distributorBillsList.reduce((sum, bill) => sum + bill.netAmount, 0);
  }

  getDistributorTotalPaid(): number {
    return this.distributorPaymentsList.reduce((sum, payment) => sum + payment.amount, 0);
  }

  getDistributorTotalDue(): number {
    return this.distributorBillsList.reduce((sum, bill) => sum + bill.dueAmount, 0);
  }

  getMedicineNameByBatch(batch: Batch): string {
    if (batch.medicineName) return batch.medicineName;
    const med = this.medicines.find(m => (batch.medicineId && m.id === batch.medicineId) || (m.batches && m.batches.some(b => b.id === batch.id)));
    return med ? med.name : 'Unknown Medicine';
  }

  getHsnCodeByBatch(batch: Batch): string {
    if (batch.hsnCode && batch.hsnCode !== '300490') return batch.hsnCode;
    const med = this.medicines.find(m => (batch.medicineId && m.id === batch.medicineId) || (batch.medicineName && m.name === batch.medicineName) || (m.batches && m.batches.some(b => b.id === batch.id)));
    return (med && med.hsnCode && med.hsnCode !== '300490') ? med.hsnCode : (batch.hsnCode || '300490');
  }

  getCategoryByBatch(batch: Batch): string {
    if (batch.category && batch.category !== 'General') return batch.category;
    const med = this.medicines.find(m => (batch.medicineId && m.id === batch.medicineId) || (batch.medicineName && m.name === batch.medicineName) || (m.batches && m.batches.some(b => b.id === batch.id)));
    return (med && med.category && med.category !== 'General') ? med.category : (batch.category || 'General');
  }

  getManufacturerByBatch(batch: Batch): string {
    if (batch.manufacturer && batch.manufacturer !== 'Unknown') return batch.manufacturer;
    const med = this.medicines.find(m => (batch.medicineId && m.id === batch.medicineId) || (batch.medicineName && m.name === batch.medicineName) || (m.batches && m.batches.some(b => b.id === batch.id)));
    return (med && med.manufacturer && med.manufacturer !== 'Unknown') ? med.manufacturer : (batch.manufacturer || 'Unknown');
  }

  getPurchasePriceByBatch(batch: Batch): number {
    return batch.purchasePrice || 0;
  }

  getBatchAmount(batch: Batch): number {
    const rate = batch.purchasePrice || 0;
    const free = batch.free || 0;
    const qty = (batch.quantity || 0) - free;
    const disc = batch.discountPercentage || 0;
    const discountedRate = rate * (1 - disc / 100);
    return discountedRate * qty;
  }

  getBillDiscount(bill: DistributorBillView): number {
    if (!bill.items) return 0;
    return bill.items.reduce((sum, item) => {
      const rate = item.purchasePrice || 0;
      const free = item.free || 0;
      const qty = (item.quantity || 0) - free;
      const disc = item.discountPercentage || 0;
      return sum + (rate * qty * disc / 100);
    }, 0);
  }

  getBillSubTotalBeforeDiscount(bill: DistributorBillView): number {
    if (!bill.items) return 0;
    return bill.items.reduce((sum, item) => {
      const rate = item.purchasePrice || 0;
      const free = item.free || 0;
      const qty = (item.quantity || 0) - free;
      return sum + (rate * qty);
    }, 0);
  }

  getGstBreakdown(bill: DistributorBillView | undefined) {
    if (!bill || !bill.items) return [];
    const groups: { [key: number]: { taxable: number, gst: number } } = {};
    for (const item of bill.items) {
      const rate = item.purchasePrice || 0;
      const free = item.free || 0;
      const qty = (item.quantity || 0) - free;
      const disc = item.discountPercentage || 0;
      const taxableItemAmount = rate * qty * (1 - disc / 100);
      const gstPct = item.gstPercentage || 0;
      const gstAmount = taxableItemAmount * gstPct / 100;
      if (!groups[gstPct]) {
        groups[gstPct] = { taxable: 0, gst: 0 };
      }
      groups[gstPct].taxable += taxableItemAmount;
      groups[gstPct].gst += gstAmount;
    }
    return Object.keys(groups).map(key => ({
      rate: Number(key),
      taxable: groups[Number(key)].taxable,
      gst: groups[Number(key)].gst
    })).sort((a, b) => b.rate - a.rate);
  }

  getBulkSubTotalBeforeDiscount(): number {
    if (!this.uploadedItems) return 0;
    return this.uploadedItems.reduce((sum, item) => {
      const rate = item.purchasePrice || 0;
      const qty = item.quantity || 0;
      return sum + (rate * qty);
    }, 0);
  }

  getBulkTotalDiscount(): number {
    if (!this.uploadedItems) return 0;
    return this.uploadedItems.reduce((sum, item) => {
      const rate = item.purchasePrice || 0;
      const qty = item.quantity || 0;
      const disc = item.discountPercentage || 0;
      return sum + (rate * qty * disc / 100);
    }, 0);
  }

  getBulkGstAmount(): number {
    if (!this.uploadedItems) return 0;
    return this.uploadedItems.reduce((sum, item) => {
      const rate = item.purchasePrice || 0;
      const qty = item.quantity || 0;
      const disc = item.discountPercentage || 0;
      const gstPercent = item.gstPercentage || 0;
      const taxable = rate * qty * (1 - disc / 100);
      return sum + (taxable * gstPercent / 100);
    }, 0);
  }

  getBulkNetAmount(): number {
    return this.getBulkSubTotalBeforeDiscount() - this.getBulkTotalDiscount() + this.getBulkGstAmount();
  }

  onBulkItemMrpChange(item: any): void {
    if (item.mrp && (!item.sellingPrice || item.sellingPrice > item.mrp)) {
      item.sellingPrice = item.mrp;
    }
    item.sellingDiscountPercent = item.mrp ? Math.max(0, Number(((item.mrp - (item.sellingPrice || 0)) / item.mrp * 100).toFixed(2))) : 0;
  }

  onBulkItemPurchasePriceChange(item: any): void {
    if (item.purchasePrice && (!item.sellingPrice || item.sellingPrice < item.purchasePrice)) {
      const suggested = Number((item.purchasePrice * 1.25).toFixed(2));
      item.sellingPrice = item.mrp ? Math.min(suggested, item.mrp) : suggested;
    }
    item.sellingDiscountPercent = item.mrp ? Math.max(0, Number(((item.mrp - (item.sellingPrice || 0)) / item.mrp * 100).toFixed(2))) : 0;
  }

  onBulkItemSellingDiscountChange(item: any): void {
    const mrp = item.mrp || 0;
    const disc = item.sellingDiscountPercent || 0;
    item.sellingPrice = Math.max(0, Number((mrp * (1 - disc / 100)).toFixed(2)));
  }

  onBulkItemSellingPriceChange(item: any): void {
    if (item.mrp && item.sellingPrice > item.mrp) {
      item.sellingPrice = item.mrp;
    }
    item.sellingDiscountPercent = item.mrp ? Math.max(0, Number(((item.mrp - (item.sellingPrice || 0)) / item.mrp * 100).toFixed(2))) : 0;
  }

  // ─── Feature 1: Analytics ───
  initAnalyticsPreset(): void {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    this.analyticsStartDate = getLocalIsoDate(start);
    this.analyticsEndDate = getLocalIsoDate(today);
  }

  onAnalyticsPresetChange(): void {
    const today = new Date();
    switch (this.analyticsDatePreset) {
      case 'today':
        this.analyticsStartDate = getLocalIsoDate(today);
        this.analyticsEndDate = getLocalIsoDate(today);
        break;
      case 'week': {
        const start = new Date(today);
        start.setDate(today.getDate() - today.getDay());
        this.analyticsStartDate = getLocalIsoDate(start);
        this.analyticsEndDate = getLocalIsoDate(today);
        break;
      }
      case 'month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        this.analyticsStartDate = getLocalIsoDate(start);
        this.analyticsEndDate = getLocalIsoDate(today);
        break;
      }
      case 'fy': {
        const currentYear = today.getFullYear();
        const start = today.getMonth() >= 3 ? new Date(currentYear, 3, 1) : new Date(currentYear - 1, 3, 1);
        const end = today.getMonth() >= 3 ? new Date(currentYear + 1, 2, 31) : new Date(currentYear, 2, 31);
        this.analyticsStartDate = getLocalIsoDate(start);
        this.analyticsEndDate = getLocalIsoDate(end);
        break;
      }
      case 'all':
        this.analyticsStartDate = '';
        this.analyticsEndDate = '';
        break;
      case 'custom':
        this.analyticsStartDate ||= getLocalIsoDate(today);
        this.analyticsEndDate ||= getLocalIsoDate(today);
        break;
      default:
        this.analyticsStartDate = '';
        this.analyticsEndDate = '';
        break;
    }
    this.loadAnalytics();
  }

  loadAnalytics(): void {
    let startDateParam: string | undefined;
    let endDateParam: string | undefined;

    if (this.analyticsDatePreset === 'all') {
      startDateParam = 'all';
      endDateParam = 'all';
    } else if (this.analyticsDatePreset === 'custom' || this.analyticsDatePreset === 'today' || this.analyticsDatePreset === 'week' || this.analyticsDatePreset === 'month' || this.analyticsDatePreset === 'fy') {
      startDateParam = this.analyticsStartDate;
      endDateParam = this.analyticsEndDate;
    }

    this.api.analytics(this.analyticsChartPeriod, startDateParam, endDateParam).subscribe({
      next: data => {
        this.analyticsData = data;
        if (data && data.dailySales && data.dailySales.length > 0) {
          this.selectedSalesPoint = data.dailySales[data.dailySales.length - 1];
        } else {
          this.selectedSalesPoint = undefined;
        }
      },
      error: () => { } // Silently fail for non-admin users
    });
  }

  maxDailySales(): number {
    if (!this.analyticsData?.dailySales) return 0;
    return Math.max(...this.analyticsData.dailySales.map(d => d.revenue), 1);
  }

  maxTopMedicine(): number {
    if (!this.analyticsData?.topMedicines?.length) return 0;
    return Math.max(...this.analyticsData.topMedicines.map(m => m.totalRevenue), 1);
  }

  maxCategoryRevenue(): number {
    if (!this.analyticsData?.categoryRevenue?.length) return 0;
    return Math.max(...this.analyticsData.categoryRevenue.map(c => c.totalRevenue), 1);
  }

  maxSlowMedicineQuantity(): number {
    if (!this.analyticsData?.slowMedicines?.length) return 0;
    return Math.max(...this.analyticsData.slowMedicines.map(m => m.totalQuantity), 1);
  }

  maxPaymentModeRevenue(): number {
    if (!this.analyticsData?.paymentModeShare?.length) return 0;
    return Math.max(...this.analyticsData.paymentModeShare.map(p => p.totalRevenue), 1);
  }

  // ─── Feature 2: Barcode Scan ───
  handleBarcodeScan(): void {
    const code = this.barcodeScanInput.trim();
    if (!code) return;
    const medicine = this.medicines.find(m => m.code === code);
    if (medicine) {
      this.addToCart(medicine);
      this.message = `${medicine.name} added to cart via barcode`;
    } else {
      this.message = `No medicine found with code: ${code}`;
    }
    this.barcodeScanInput = '';
  }

  showBarcodeLabel(medicine: any): void {
    this.barcodeMedicine = medicine;
    this.showBarcodeModal = true;
    setTimeout(() => {
      try {
        const jsBarcode = (window as any).JsBarcode;
        jsBarcode("#barcode-canvas", medicine.code, {
          format: "CODE128",
          lineColor: "#000",
          width: 2,
          height: 80,
          displayValue: true
        });
      } catch (err) {
        console.error('Error generating barcode', err);
      }
    }, 50);
  }

  closeBarcodeModal(): void {
    this.showBarcodeModal = false;
    this.barcodeMedicine = null;
  }

  printBarcodeLabel(): void {
    if (!this.barcodeMedicine) return;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`
        <html>
          <head>
            <title>Print Barcode Label</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }
              h3 { margin: 0 0 5px 0; font-size: 14px; }
              p { margin: 0 0 10px 0; font-size: 11px; }
              @media print {
                body { width: 50mm; height: 30mm; }
              }
            </style>
          </head>
          <body onload="window.print(); window.close();">
            <h3>${this.barcodeMedicine.name}</h3>
            <p>MRP: ${(this.barcodeMedicine.mrp ?? 0).toFixed(2)}</p>
            ${document.getElementById('barcode-canvas')?.outerHTML || ''}
          </body>
        </html>
      `);
      win.document.close();
    }
  }

  // ─── Feature 3: PDF Export (Standard Full-Width A4 Pharmacy Bill Format) ───
  generatePdfDocument(s: Sale): any {
    try {
      const { jsPDF } = (window as any).jspdf;

      // Standard A4 Full-Width Dimensions (210mm x 297mm) - Spacious & Perfectly Aligned
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      // Helper for 12-hour formatted time (e.g. 09:51 PM)
      const formatTime12h = (dateInput: any) => {
        if (!dateInput) return '-';
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return '-';
        let hours = d.getHours();
        const minutes = d.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const minsStr = minutes < 10 ? '0' + minutes : String(minutes);
        const hrsStr = hours < 10 ? '0' + hours : String(hours);
        return `${hrsStr}:${minsStr} ${ampm}`;
      };

      const formatDate = (dateInput: any) => {
        if (!dateInput) return '-';
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return '-';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}/${month}/${d.getFullYear()}`;
      };

      // Helper for solid strong divider lines (from x=8 to x=202)
      const drawSolidLine = (yPos: number) => {
        doc.setLineWidth(0.3);
        doc.setDrawColor(35, 35, 35);
        doc.setLineDashPattern([], 0);
        doc.line(8, yPos, 202, yPos);
      };

      // Helper for dotted/dashed divider lines matching on-screen dashed borders
      const drawDashedLine = (yPos: number) => {
        doc.setLineWidth(0.25);
        doc.setDrawColor(100, 100, 100);
        doc.setLineDashPattern([2, 1.5], 0);
        doc.line(8, yPos, 202, yPos);
        doc.setLineDashPattern([], 0);
      };

      doc.setTextColor(0, 0, 0);

      // --- Header (Times serif font matching Attachment 1) ---
      let y = 18;
      doc.setFont('times', 'bold');
      doc.setFontSize(13.5);
      const storeTitle = (this.storeBill.name || 'SRI LAKSHMI MEDICAL AND FANCY STORES').toUpperCase();
      doc.text(storeTitle, 12, y);
      const titleWidth = doc.getTextWidth(storeTitle);
      doc.setLineWidth(0.35);
      doc.line(12, y + 1.2, 12 + Math.min(titleWidth, 115), y + 1.2);

      // Header Address details (Left aligned)
      y += 6.5;
      doc.setFont('times', 'normal');
      doc.setFontSize(9.5);
      doc.text(this.storeBill.addressLine1 || 'D. No. 1-176, Beside Gandhi statue,', 12, y);
      y += 5;
      doc.text(this.storeBill.addressLine2 || 'Main Road Makkapeta, Makkapeta-521190', 12, y);
      y += 5;
      doc.text(`Phone No : ${this.storeBill.phone || '9989207847'}`, 12, y);

      // Invoice & GST NO at Right Corner (aligned right at x = 198)
      doc.setFont('times', 'normal');
      doc.setFontSize(9.5);
      doc.text(`Invoice : ${s.billNo}`, 198, 29.5, { align: 'right' });
      doc.text(`GST NO: ${this.storeBill.gstNumber || '36AGYPV269P1ZU'}`, 198, 34.5, { align: 'right' });

      // Solid Line 1 (Top 1)
      y += 4;
      drawSolidLine(y);

      // --- 6 Customer Metadata Fields (3 clear columns with aligned colons) ---
      y += 5.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.8);

      // Row 1
      doc.text('Name', 12, y);
      doc.text(':', 29, y);
      doc.setFont('helvetica', 'bold');
      doc.text(s.customerName || 'Walk-in', 32, y);

      doc.setFont('helvetica', 'normal');
      doc.text('Phone No', 78, y);
      doc.text(':', 95, y);
      doc.setFont('helvetica', 'bold');
      doc.text(s.customerMobile || '-', 98, y);

      doc.setFont('helvetica', 'normal');
      doc.text('Address', 140, y);
      doc.text(':', 156, y);
      doc.setFont('helvetica', 'bold');
      doc.text(s.customerAddress || '-', 159, y);

      // Row 2
      y += 5.5;
      doc.setFont('helvetica', 'normal');
      doc.text('Dr. Name', 12, y);
      doc.text(':', 29, y);
      doc.setFont('helvetica', 'bold');
      doc.text(s.doctorName || '-', 32, y);

      doc.setFont('helvetica', 'normal');
      doc.text('Date', 78, y);
      doc.text(':', 95, y);
      doc.setFont('helvetica', 'bold');
      doc.text(formatDate(s.createdAt), 98, y);

      doc.setFont('helvetica', 'normal');
      doc.text('Time', 140, y);
      doc.text(':', 156, y);
      doc.setFont('helvetica', 'bold');
      doc.text(formatTime12h(s.createdAt), 159, y);

      // Solid Line 2 (Top 2)
      y += 4;
      drawSolidLine(y);

      // --- Items Table Header (Distinct, Non-Overlapping Coordinates) ---
      y += 5.5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);

      doc.text('Sno', 12, y);
      doc.text('Product Name', 19, y);
      doc.text('Batch', 57, y);
      doc.text('Expiry', 72, y);
      doc.text('QTY', 117, y, { align: 'right' });
      doc.text('MRP', 131, y, { align: 'right' });
      doc.text('Disc%', 144, y, { align: 'right' });
      doc.text('Price', 157, y, { align: 'right' });
      doc.text('GST %', 169, y, { align: 'right' });
      doc.text('GST', 182, y, { align: 'right' });
      doc.text('Amount', 198, y, { align: 'right' });

      // Solid Line 3 (Top 3)
      y += 3;
      drawSolidLine(y);

      // --- Items Rows ---
      let sno = 1;
      s.items.forEach((item: any) => {
        y += 6.5;

        const prodName = item.medicineName || '';
        let expText = '-';
        if (item.expiryDate) {
          const expDate = new Date(item.expiryDate);
          expText = `${String(expDate.getMonth() + 1).padStart(2, '0')}/${expDate.getFullYear()}`;
        }
        const itemMrp = item.mrp && item.mrp > 0 ? item.mrp : item.sellingPrice;
        const actualDis = this.actualDiscount(s, item);
        const discPct = itemMrp > 0 ? ((actualDis / itemMrp) * 100) : 0;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(0, 0, 0);

        doc.text(String(sno), 12, y);
        doc.text(prodName, 19, y, { maxWidth: 36 });
        doc.text(item.batchNo || '-', 57, y);
        doc.text(expText, 72, y);
        doc.text(this.formatBillQty(item), 117, y, { align: 'right' });
        doc.text(itemMrp.toFixed(2), 131, y, { align: 'right' });
        doc.text(`${discPct.toFixed(2)}%`, 144, y, { align: 'right' });
        doc.text(this.actualPrice(s, item).toFixed(2), 157, y, { align: 'right' });
        doc.text(`${item.gstPercentage || 0}%`, 169, y, { align: 'right' });
        doc.text((item.gstAmount || 0).toFixed(2), 182, y, { align: 'right' });
        doc.text(this.actualItemAmount(s, item).toFixed(2), 198, y, { align: 'right' });

        // Mfr & Pack Subtext (matching Customer Bill screen view)
        const mfr = item.manufacturer || '-';
        const packStr = this.getMedicinePack(item);
        y += 4;
        doc.setFontSize(7.2);
        doc.setTextColor(85, 85, 85);
        doc.text(`Mfr: ${mfr} | Pack: ${packStr}`, 19, y);

        sno++;
      });

      // Spacious Table Breathing Room (ensures minimum height matching HTML view)
      y = Math.max(y + 6, 122);

      // Dotted/Dashed Line 4 (Above Totals)
      drawDashedLine(y);

      // --- Totals Line 1: Gross | Discount | Net Amt ---
      y += 5.5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      doc.text('Gross:', 12, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(this.billGross(s).toFixed(2), 26, y);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('Discount:', 90, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(this.billDiscount(s).toFixed(2), 107, y);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('Net Amt:', 152, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(s.netAmount.toFixed(2), 198, y, { align: 'right' });

      // Dotted/Dashed Line 5 (Below Totals)
      y += 4.5;
      drawDashedLine(y);

      // --- Tax Line 2: Taxable Value | GST | Round | CASH | PAID ---
      y += 5;
      doc.setFontSize(8.2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      doc.text(`Taxable Value: ${(s.totalAmount || (s.netAmount - (s.gstAmount || 0))).toFixed(2)}`, 12, y);
      doc.text(`GST: ${(s.gstAmount || 0).toFixed(2)}`, 78, y);
      doc.text(`Round: ${(s.roundingAmount || 0).toFixed(2)}`, 128, y);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(`${s.paymentMode || 'CASH'} | ${s.paymentStatus || 'PAID'}`, 198, y, { align: 'right' });

      // Dotted/Dashed Line 6 (Below Tax Line)
      y += 4.5;
      drawDashedLine(y);

      // --- Footer ---
      y += 5.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 30, 30);
      doc.text('*Goods once sold will not be taken back, only exchanged before one week (Bill is Mandatory)', 12, y);
      y += 3.8;
      doc.text('*Damaged/Fridge Items will not be exchanged', 12, y);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(storeTitle, 198, y, { align: 'right' });

      // --- Single Outer Frame Border ---
      const borderHeight = (y + 6) - 10;
      doc.setLineWidth(0.4);
      doc.setDrawColor(35, 35, 35);
      doc.rect(8, 10, 194, borderHeight);

      return doc;
    } catch (err) {
      console.error('Error generating PDF with jsPDF', err);
      return null;
    }
  }

  downloadPdf(sale?: Sale): void {
    const s = sale || this.viewingInvoice || this.lastSale;
    if (!s) return;

    const doc = this.generatePdfDocument(s);
    if (doc) {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice_${s.billNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } else {
      this.message = 'Could not generate PDF invoice using jsPDF. Downloading text fallback.';
      const blob = new Blob([`Invoice: ${s.billNo}\nCustomer: ${s.customerName}\nNet: ${s.netAmount}`], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice_${s.billNo}.txt`;
      a.click();
    }
  }

  toggleSelectCredit(id: number): void {
    if (this.selectedCreditIds.has(id)) {
      this.selectedCreditIds.delete(id);
    } else {
      this.selectedCreditIds.add(id);
    }
  }

  isCreditSelected(id: number): boolean {
    return this.selectedCreditIds.has(id);
  }

  toggleSelectAllCredits(creditsList: any[]): void {
    if (this.isAllCreditsSelected(creditsList)) {
      creditsList.forEach(c => this.selectedCreditIds.delete(c.id));
    } else {
      creditsList.forEach(c => this.selectedCreditIds.add(c.id));
    }
  }

  isAllCreditsSelected(creditsList: any[]): boolean {
    if (creditsList.length === 0) return false;
    return creditsList.every(c => this.selectedCreditIds.has(c.id));
  }

  sendBulkWhatsAppReminders(): void {
    const ids = Array.from(this.selectedCreditIds);
    if (ids.length === 0) {
      this.message = 'Please select at least one credit transaction to send reminders.';
      return;
    }

    const selectedCredits = this.credits.filter((c: Credit) => ids.includes(c.id));

    if (selectedCredits.length === 1) {
      const credit = selectedCredits[0];
      this.showConfirm(
        `Are you sure you want to send a WhatsApp dues reminder to ${credit.customerName} for Bill ${credit.billNo}?`,
        () => this.submitBulkWhatsAppRemindersPayload(ids),
        'Send WhatsApp Reminder'
      );
    } else {
      const names = selectedCredits.map((c: Credit) => c.customerName);
      const uniqueNames = Array.from(new Set(names));
      let namesDisplay = '';
      if (uniqueNames.length <= 3) {
        namesDisplay = uniqueNames.join(', ');
      } else {
        namesDisplay = `${uniqueNames.slice(0, 3).join(', ')} and ${uniqueNames.length - 3} others`;
      }

      this.showConfirm(
        `Are you sure you want to send WhatsApp reminders to ${selectedCredits.length} selected credit transaction(s) for ${namesDisplay}?`,
        () => this.submitBulkWhatsAppRemindersPayload(ids),
        'Send Bulk WhatsApp Reminders'
      );
    }
  }

  private submitBulkWhatsAppRemindersPayload(ids: number[]): void {
    this.busy = true;
    let successCount = 0;
    let completedCount = 0;
    const selectedCredits = this.credits.filter((c: Credit) => ids.includes(c.id));

    ids.forEach(id => {
      this.api.sendCreditReminder(id).subscribe({
        next: () => {
          successCount++;
          completedCount++;
          if (completedCount === ids.length) {
            this.busy = false;
            this.selectedCreditIds.clear();
            if (ids.length === 1 && selectedCredits.length === 1) {
              this.message = `WhatsApp reminder sent successfully to ${selectedCredits[0].customerName}.`;
            } else {
              this.message = `Bulk dispatch complete. Sent ${successCount} out of ${ids.length} reminders successfully.`;
            }
          }
        },
        error: () => {
          completedCount++;
          if (completedCount === ids.length) {
            this.busy = false;
            this.selectedCreditIds.clear();
            if (ids.length === 1 && selectedCredits.length === 1) {
              this.message = `Error: Failed to send WhatsApp reminder to ${selectedCredits[0].customerName}.`;
            } else {
              this.message = `Bulk dispatch complete. Sent ${successCount} out of ${ids.length} reminders successfully.`;
            }
          }
        }
      });
    });
  }

  // ─── WhatsApp Integration ───
  sendWhatsAppCreditReminder(credit: any): void {
    this.showConfirm(
      `Are you sure you want to send a WhatsApp dues reminder to ${credit.customerName} for Bill ${credit.billNo}?`,
      () => this.submitWhatsAppCreditReminderPayload(credit),
      'Send WhatsApp Reminder'
    );
  }

  private submitWhatsAppCreditReminderPayload(credit: any): void {
    this.busy = true;
    this.api.sendCreditReminder(credit.id).subscribe({
      next: () => {
        this.busy = false;
        this.message = `Dues reminder request for ${credit.customerName} sent to the gateway.`;
      },
      error: error => this.fail(error)
    });
  }

  sendWhatsAppInvoice(sale?: Sale): void {
    const s = sale || this.viewingInvoice || this.lastSale;
    if (!s) return;

    let pdfBase64: string | undefined;
    let filename: string | undefined;

    try {
      const doc = this.generatePdfDocument(s);
      if (doc) {
        filename = `Invoice_${s.billNo}.pdf`;
        const dataUri = doc.output('datauristring');
        pdfBase64 = dataUri.split(',')[1];
      }
    } catch (err) {
      console.warn('Could not attach PDF base64 for WhatsApp message', err);
    }

    this.busy = true;
    this.api.sendWhatsAppInvoice(s.id, pdfBase64, filename).subscribe({
      next: () => {
        this.busy = false;
        this.message = `Invoice PDF document for ${s.billNo} dispatched to WhatsApp gateway.`;
      },
      error: error => this.fail(error)
    });
  }

  openWhatsAppWeb(sale?: Sale): void {
    const s = sale || this.viewingInvoice || this.lastSale;
    if (!s) return;
    if (!s.customerMobile) {
      this.message = 'Error: Customer mobile number is missing.';
      return;
    }

    this.downloadPdf(s);

    let phone = s.customerMobile.replace(/[^0-9]/g, '');
    if (phone.length === 10) phone = '91' + phone;

    const storeName = this.storeBill.name || 'SRI LAKSHMI MEDICAL AND FANCY STORES';
    const storePhone = this.storeBill.phone || '9989207847';
    const text = `*INVOICE BILL* from *${storeName}*\nBill No: *${s.billNo}*\nCustomer: ${s.customerName || 'Walk-in'}\nNet Amount: *₹${s.netAmount}*\n\nPhone: ${storePhone}\n\n📌 *(The downloaded PDF invoice is ready on your computer — attach it to send!)*`;

    const waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
    this.message = `Invoice PDF downloaded & WhatsApp Web opened for ${s.customerName || 'Customer'}. Drag & drop the downloaded PDF into WhatsApp Web!`;
  }

  triggerDailyRemindersJob(): void {
    this.showConfirm(
      'Are you sure you want to trigger the daily WhatsApp dues reminder scan now?',
      () => this.submitDailyRemindersJobPayload(),
      'Trigger Reminder Scan'
    );
  }

  private submitDailyRemindersJobPayload(): void {
    this.busy = true;
    this.api.triggerDailyReminders().subscribe({
      next: () => {
        this.busy = false;
        this.message = 'Daily WhatsApp dues reminders scan initiated successfully.';
      },
      error: error => this.fail(error)
    });
  }

  getPendingReminders(): any[] {
    if (!this.storeBill.enableAutoReminders) return [];
    const todayStr = getLocalIsoDate();
    const today = new Date(todayStr).getTime();
    const triggerThresholdMs = this.storeBill.reminderDays * 24 * 60 * 60 * 1000;

    return this.credits.filter((c: Credit) => {
      if (c.status !== 'OPEN') return false;
      const dueTime = new Date(c.dueDate).getTime();
      const diff = dueTime - today;
      return diff <= triggerThresholdMs;
    });
  }

  // ─── Feature 4: Distributor Comparison ───
  loadDistributorComparison(): void {
    this.busy = true;
    this.api.distributorComparison().subscribe({
      next: data => { this.distributorComparisonData = data; this.busy = false; },
      error: error => this.fail(error)
    });
  }

  filteredComparisons(): DistributorPriceComparison[] {
    if (!this.comparisonSearchQuery.trim()) return this.distributorComparisonData;
    const q = this.comparisonSearchQuery.toLowerCase();
    return this.distributorComparisonData.filter(c =>
      c.medicineName.toLowerCase().includes(q) ||
      (c.genericName && c.genericName.toLowerCase().includes(q))
    );
  }

  bestPrice(comparison: DistributorPriceComparison): number {
    return Math.min(...comparison.distributorPrices.map(p => p.purchasePrice));
  }

  // ─── Feature 5: Activity Log ───
  loadActivityLogs(): void {
    this.busy = true;
    this.api.activityLogs().subscribe({
      next: data => { this.activityLogData = data; this.busy = false; },
      error: error => this.fail(error)
    });
  }

  isErrorMessage(msg: string): boolean {
    if (!msg) return false;
    const lower = msg.toLowerCase();
    return lower.startsWith('error:') ||
      lower.includes('error') ||
      lower.includes('failed') ||
      lower.includes('invalid') ||
      lower.includes('not found') ||
      lower.includes('cannot') ||
      lower.includes('unable') ||
      lower.includes('missing') ||
      lower.includes('required') ||
      lower.includes('denied') ||
      lower.includes('unauthorized') ||
      lower.includes('capped at');
  }

  private fail(error: HttpErrorResponse): void {
    this.busy = false;
    const rawMsg = error.error?.message ?? (typeof error.error === 'string' ? error.error : 'The request could not be completed.');
    this.message = rawMsg.startsWith('Error:') ? rawMsg : `Error: ${rawMsg}`;
    if (error.status === 401) {
      this.logout();
    }
  }

  private rowsFor(medicines: Medicine[]): InventoryRow[] {
    return medicines.flatMap(medicine => medicine.batches.map(batch => ({
      medicine,
      batch,
      daysUntilExpiry: this.daysUntil(batch.expiryDate),
      expiryState: this.expiryState(batch.expiryDate)
    })));
  }

  private expiryState(expiryDate: string): ExpiryState {
    const days = this.daysUntil(expiryDate);
    if (days < 0) {
      return 'expired';
    }
    return days <= this.nearExpiryDays ? 'near' : 'valid';
  }

  private daysUntil(expiryDate: string): number {
    const oneDay = 24 * 60 * 60 * 1000;
    const expiry = new Date(`${expiryDate}T00:00:00`).getTime();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.floor((expiry - todayStart) / oneDay);
  }

  private resetMedicineForm(): void {
    this.medicineForm = {
      code: '',
      name: '',
      genericName: '',
      manufacturer: '',
      category: '',
      hsnCode: '',
      gstPercentage: 0,
      mrp: 0,
      sellingPrice: 0,
      discount: 0,
      prescriptionRequired: false,
      stockWatchQty: 0,
      sideEffects: ''
    };
  }

  private resetDistributorForm(): void {
    this.distributorForm = {
      name: '',
      contactPerson: '',
      mobile: '',
      email: '',
      gstNumber: '',
      address: '',
      upiId: '',
      bankName: '',
      bankAccountNo: '',
      bankIfscCode: ''
    };
  }

  private resetBatchForm(): void {
    this.batchForm = {
      medicineId: 0,
      batchNo: '',
      expiryDate: '',
      purchasePrice: 0,
      sellingPrice: 0,
      quantity: 0,
      availableQuantity: 0,
      distributorId: 0,
      billNo: '',
      billDate: '',
      dueDate: '',
      gstPercentage: 0,
      mrp: 0,
      discount: 0
    };
  }

  aiTargetLanguage = 'en';
  aiTranslating = false;
  aiOriginalSearchResult: AiPharmacistResponse | null = null;
  readonly aiLanguages = [
    { code: 'en', name: 'English', voiceLocale: 'en-US' },
    { code: 'hi', name: 'Hindi (हिन्दी)', voiceLocale: 'hi-IN' },
    { code: 'te', name: 'Telugu (తెలుగు)', voiceLocale: 'te-IN' },
    { code: 'ta', name: 'Tamil (தமிழ்)', voiceLocale: 'ta-IN' },
    { code: 'kn', name: 'Kannada (ಕನ್ನಡ)', voiceLocale: 'kn-IN' },
    { code: 'mr', name: 'Marathi (मराठी)', voiceLocale: 'mr-IN' },
    { code: 'bn', name: 'Bengali (বাংলা)', voiceLocale: 'bn-IN' },
    { code: 'ml', name: 'Malayalam (മലയാളം)', voiceLocale: 'ml-IN' }
  ];

  searchAiPharmacist(query?: string): void {
    const medQuery = query || this.aiSearchQuery;
    if (!medQuery || !medQuery.trim()) {
      this.aiSearchError = 'Please enter a medicine name or select one from the inventory.';
      return;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.aiSpeaking = false;
    this.aiTargetLanguage = 'en';
    this.aiOriginalSearchResult = null;

    this.aiSearching = true;
    this.aiSearchError = '';
    this.aiSearchResult = null;

    this.api.searchAiPharmacist(medQuery.trim()).subscribe({
      next: (result) => {
        this.aiSearching = false;
        this.aiSearchResult = result;
        this.aiOriginalSearchResult = result;
      },
      error: (err) => {
        this.aiSearching = false;
        this.aiSearchError = err.error?.message || 'Failed to fetch information from the AI Pharmacist. Please verify settings.';
      }
    });
  }

  clearAiSearch(): void {
    this.aiSearchQuery = '';
    this.aiSearchResult = null;
    this.aiOriginalSearchResult = null;
    this.aiSearchError = '';
    this.aiTargetLanguage = 'en';
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.aiSpeaking = false;
  }

  onAiLanguageChange(langCode: string): void {
    if (!this.aiOriginalSearchResult) return;

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.aiSpeaking = false;
    this.aiTargetLanguage = langCode;

    if (langCode === 'en') {
      this.aiSearchResult = this.aiOriginalSearchResult;
      return;
    }

    const selectedLangObj = this.aiLanguages.find(l => l.code === langCode);
    if (!selectedLangObj) return;

    this.aiTranslating = true;
    this.aiSearchError = '';

    const detailsJsonStr = JSON.stringify(this.aiOriginalSearchResult);

    this.api.translateAiPharmacist(detailsJsonStr, selectedLangObj.name).subscribe({
      next: (translatedResult) => {
        this.aiTranslating = false;
        this.aiSearchResult = translatedResult;
      },
      error: (err) => {
        this.aiTranslating = false;
        this.aiSearchError = err.error?.message || 'Failed to translate details. Please try again.';
      }
    });
  }

  aiSpeaking = false;
  private speechUtterance: SpeechSynthesisUtterance | null = null;

  toggleAiSpeech(): void {
    if (!this.aiSearchResult) return;

    const synth = window.speechSynthesis;
    if (!synth) {
      alert('Speech synthesis is not supported in this browser.');
      return;
    }

    if (this.aiSpeaking) {
      synth.cancel();
      this.aiSpeaking = false;
      return;
    }

    const name = this.aiSearchResult.name || '';
    const composition = this.aiSearchResult.composition || '';
    const uses = this.aiSearchResult.uses || '';
    const dosage = this.aiSearchResult.dosage || '';
    const dosAndDonts = this.aiSearchResult.dosAndDonts || '';
    const whoCanTake = this.aiSearchResult.whoCanTake || '';

    const cleanText = (text: string) => {
      if (!text) return '';
      return text.replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, '. ');
    };

    const textToSpeak = `
      Medicine Profile for ${name}.
      Composition: ${cleanText(composition)}.
      Uses: ${cleanText(uses)}.
      Dosage Guidance: ${cleanText(dosage)}.
      Do's and Don'ts: ${cleanText(cleanText(dosAndDonts))}.
      Who Can Take: ${cleanText(cleanText(whoCanTake))}.
    `.trim();

    this.speechUtterance = new SpeechSynthesisUtterance(textToSpeak);

    const currentLang = this.aiLanguages.find(l => l.code === this.aiTargetLanguage) || this.aiLanguages[0];
    const targetLocale = currentLang.voiceLocale;

    const voices = synth.getVoices();
    if (voices.length > 0) {
      let activeVoice = voices.find(v => v.lang.toLowerCase() === targetLocale.toLowerCase()) ||
        voices.find(v => v.lang.startsWith(currentLang.code)) ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0];
      this.speechUtterance.voice = activeVoice;
    }

    this.speechUtterance.rate = 0.95;
    this.speechUtterance.pitch = 1.0;

    this.speechUtterance.onend = () => {
      this.aiSpeaking = false;
      this.speechUtterance = null;
    };

    this.speechUtterance.onerror = () => {
      this.aiSpeaking = false;
      this.speechUtterance = null;
    };

    this.aiSpeaking = true;
    synth.speak(this.speechUtterance);
  }

  quickAiSearch(medicineName: string): void {
    this.aiSearchQuery = medicineName;
    this.show('ai-pharmacist');
    this.searchAiPharmacist(medicineName);
  }

  getMatchingInventoryMedicine(): any {
    if (!this.aiSearchResult) return null;
    const query = (this.aiSearchResult.name || '').toLowerCase();
    const composition = (this.aiSearchResult.composition || '').toLowerCase();

    return this.medicines.find(m => {
      const mName = m.name.toLowerCase();
      const mGen = (m.genericName || '').toLowerCase();
      return mName.includes(query) || query.includes(mName) ||
        (mGen && (mGen.includes(composition) || composition.includes(mGen)));
    }) || null;
  }

  formatDosAndDonts(text: string): string {
    if (!text) return '';
    const lines = text.split(/\r?\n/);
    const formattedLines = lines.map(line => {
      let trimmed = line.trim();
      if (!trimmed) return '';

      const doRegex = /^(?:[-*\d\.\s]*)\b(DO)\b:?\s*(.*)$/i;
      const dontRegex = /^(?:[-*\d\.\s]*)\b(DON'T|DONT)\b:?\s*(.*)$/i;

      if (dontRegex.test(trimmed)) {
        const match = trimmed.match(dontRegex);
        const content = match && match[2] ? match[2].trim() : trimmed;
        return `<div class="ai-dont-line"><span class="badge-dont">DON'T</span> ${content}</div>`;
      } else if (doRegex.test(trimmed)) {
        const match = trimmed.match(doRegex);
        const content = match && match[2] ? match[2].trim() : trimmed;
        return `<div class="ai-do-line"><span class="badge-do">DO</span> ${content}</div>`;
      }

      let formatted = trimmed
        .replace(/\bDO\b:?/gi, '<span class="badge-do">DO</span>')
        .replace(/\bDON'T\b:?/gi, '<span class="badge-dont">DON\'T</span>')
        .replace(/\bDONT\b:?/gi, '<span class="badge-dont">DON\'T</span>');
      return `<div class="ai-neutral-line">${formatted}</div>`;
    });

    return formattedLines.filter(l => l !== '').join('');
  }

  formatDosage(text: string): string {
    if (!text) return '';
    let formatted = text
      .replace(/\bAdults?\b:?/gi, '<span class="badge-adult">Adults</span>')
      .replace(/\bChildren\b:?/gi, '<span class="badge-child">Children</span>')
      .replace(/\bPediatric\b:?/gi, '<span class="badge-child">Children</span>');
    return formatted.replace(/\n/g, '<br/>');
  }

  formatWhoCanTake(text: string): string {
    if (!text) return '';
    let formatted = text
      .replace(/\b(KIDS|CHILDREN)\b:?/gi, '<span class="badge-who-kids">🧒 Kids / Children</span><br/>')
      .replace(/\b(PREGNANT|PREGNANCY)\b:?/gi, '<span class="badge-who-pregnant">🤰 Pregnancy & Lactation</span><br/>')
      .replace(/\bCHRONIC\b:?/gi, '<span class="badge-who-chronic">❤️ Chronic Conditions (BP / Liver / Kidney)</span><br/>');
    return formatted.replace(/\n/g, '<br/>');
  }
}
