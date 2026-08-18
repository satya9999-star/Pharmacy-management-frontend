import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { from, Observable, switchMap, map } from 'rxjs';

const API_URL = 'http://localhost:8091/api';

export type Role = 'ADMIN' | 'STAFF' | 'PHARMACIST';
export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'CREDIT';

export interface AiPharmacistResponse {
  name: string;
  composition: string;
  uses: string;
  dosage: string;
  dosAndDonts: string;
  interactions: string;
  sideEffects: string;
  precautions: string;
  storage: string;
  whoCanTake: string;
}

export interface LoginResponse {
  token: string;
  username: string;
  fullName: string;
  role: Role;
  passwordResetRequired?: boolean;
}

export interface UserView {
  id: number;
  username: string;
  fullName: string;
  mobile?: string;
  email?: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface Dashboard {
  todaySales: number;
  monthRevenue: number;
  lowStockBatches: number;
  expiringBatches: number;
  pendingCredits: number;
  todayBills: number;
  customerCredits: number;
  paymentsToDistributors: number;
  customerDues: number;
  distributorPurchases: number;
  distributorDues: number;
  expiredCost: number;
  totalExpenditure: number;
  expWages: number;
  expBills: number;
  expMaintenance: number;
  expMisc: number;
}

export interface Batch {
  id: number;
  batchNo: string;
  expiryDate: string;
  purchasePrice: number;
  sellingPrice: number;
  availableQuantity: number;
  quantity: number;
  gstPercentage: number;
  mrp: number;
  distributorName: string;
  billNo?: string;
  billDate?: string;
  dueDate?: string;
  free?: number;
  discountPercentage?: number;
  medicineId?: number;
  medicineCode?: string;
  medicineName?: string;
  manufacturer?: string;
  category?: string;
  hsnCode?: string;
  looseUnitsAvailable?: number;
}

export interface Medicine {
  id: number;
  code: string;
  name: string;
  genericName: string;
  manufacturer: string;
  category: string;
  hsnCode: string;
  gstPercentage: number;
  mrp: number;
  sellingPrice: number;
  prescriptionRequired: boolean;
  stockWatchQty: number;
  availableQuantity: number;
  batches: Batch[];
  orderStatus?: string;
  orderedDate?: string;
  orderedDistributorId?: number;
  orderedDistributorName?: string;
  orderedQuantity?: number;
  sideEffects?: string;
}

export interface MasterMedicineView {
  id: number;
  name: string;
  saltComposition: string;
  medicineDesc?: string;
  sideEffects?: string;
  drugInteractions?: string;
  manufacturerName: string;
  category: string;
  price: number;
  packSizeLabel: string;
  discontinued: boolean;
}

export interface Distributor {
  id: number;
  name: string;
  contactPerson: string;
  mobile: string;
  email?: string;
  gstNumber: string;
  address: string;
  upiId?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfscCode?: string;
}

export interface DistributorBillView {
  id: number;
  distributorName: string;
  billNo: string;
  billDate: string;
  dueDate: string;
  totalAmount: number;
  gstAmount: number;
  netAmount: number;
  paidAmount: number;
  dueAmount: number;
  status: string;
  items: Batch[];
}

export interface DistributorPaymentView {
  id: number;
  billNo: string;
  amount: number;
  paymentDate: string;
  paymentMode: string;
  referenceNo: string;
}

export interface Customer {
  id: number;
  name: string;
  mobile: string;
  address: string;
  creditLimit: number;
  outstanding: number;
}

export interface Sale {
  id: number;
  billNo: string;
  customerName: string;
  customerMobile?: string;
  customerAddress?: string;
  customerAge: string;
  doctorName: string;
  totalAmount: number;
  discountAmount: number;
  gstAmount: number;
  roundingAmount: number;
  netAmount: number;
  paymentMode: PaymentMode;
  paymentStatus: string;
  createdAt: string;
  items: Array<{
    medicineName: string;
    manufacturer?: string;
    batchNo: string;
    expiryDate: string;
    quantity: number;
    sellingPrice: number;
    gstPercentage: number;
    totalAmount: number;
    gstAmount: number;
    mrp?: number;
    discount?: number;
  }>;
  purchaseBase?: number;
  profit?: number;
  inputGst?: number;
  gstPayable?: number;
}

export interface CustomerPayment {
  id: number;
  amount: number;
  paymentDate: string;
  paymentMode: string;
  referenceNo?: string;
}

export interface Credit {
  id: number;
  customerId: number;
  customerName: string;
  billNo: string;
  billDate: string;
  creditAmount: number;
  paidAmount: number;
  dueAmount: number;
  dueDate: string;
  status: string;
  payments?: CustomerPayment[];
  showPayments?: boolean;
}

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

// Analytics interfaces
export interface DailySalesPoint {
  date: string;
  revenue: number;
  billCount: number;
}
export interface TopMedicine {
  name: string;
  totalQuantity: number;
  totalRevenue: number;
}
export interface CategoryRevenue {
  category: string;
  totalRevenue: number;
}
export interface PaymentModeShare {
  mode: string;
  totalRevenue: number;
}
export interface Analytics {
  dailySales: DailySalesPoint[];
  topMedicines: TopMedicine[];
  categoryRevenue: CategoryRevenue[];
  slowMedicines: TopMedicine[];
  paymentModeShare: PaymentModeShare[];
}

// Distributor Comparison interfaces
export interface DistributorPriceEntry {
  distributorName: string;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number;
  batchNo: string;
  expiryDate: string;
  availableQuantity: number;
  billNo?: string;
  billDate?: string;
}
export interface DistributorPriceComparison {
  medicineId: number;
  medicineName: string;
  genericName: string;
  distributorPrices: DistributorPriceEntry[];
}

// Activity Log interface
export interface ActivityLogEntry {
  id: number;
  action: string;
  performedBy: string;
  details: string;
  entityType: string;
  entityId: number;
  createdAt: string;
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = sessionStorage.getItem('pharmacy-token');
  return next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);
};

@Injectable({ providedIn: 'root' })
export class PharmacyApi {
  private readonly http = inject(HttpClient);

  getPublicKey(): Observable<string> {
    return this.http.get(`${API_URL}/auth/public-key`, { responseType: 'text' });
  }

  getMasterCompositionsCsv(): Observable<string> {
    return this.http.get('assets/master_compositions.csv', { responseType: 'text' });
  }

  private async encryptValue(value: string): Promise<string> {
    if (!value) return value;
    try {
      const base64Key = await new Promise<string>((resolve, reject) => {
        this.getPublicKey().subscribe({
          next: key => resolve(key),
          error: err => reject(err)
        });
      });

      const binaryDerString = window.atob(base64Key);
      const len = binaryDerString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryDerString.charCodeAt(i);
      }

      const publicKey = await window.crypto.subtle.importKey(
        "spki",
        bytes.buffer,
        {
          name: "RSA-OAEP",
          hash: "SHA-1"
        },
        true,
        ["encrypt"]
      );

      const encoder = new TextEncoder();
      const encodedValue = encoder.encode(value);
      const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
          name: "RSA-OAEP"
        },
        publicKey,
        encodedValue
      );

      const encryptedBytes = new Uint8Array(encryptedBuffer);
      let binaryString = "";
      for (let i = 0; i < encryptedBytes.byteLength; i++) {
        binaryString += String.fromCharCode(encryptedBytes[i]);
      }
      return window.btoa(binaryString);
    } catch (e) {
      console.error("Encryption failed, falling back to plaintext", e);
      return value;
    }
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return from(this.encryptValue(password)).pipe(
      switchMap(encryptedPassword =>
        this.http.post<LoginResponse>(`${API_URL}/auth/login`, { username, password: encryptedPassword })
      )
    );
  }

  dashboard(): Observable<Dashboard> {
    return this.http.get<Dashboard>(`${API_URL}/dashboard`);
  }

  medicines(): Observable<Medicine[]> {
    return this.http.get<Medicine[]>(`${API_URL}/medicines`);
  }

  searchMasterMedicines(query: string, limit: number = 20): Observable<MasterMedicineView[]> {
    return this.http.get<MasterMedicineView[]>(`${API_URL}/medicines/master/search`, {
      params: { query, limit: limit.toString() }
    });
  }

  createMedicine(payload: Record<string, unknown>): Observable<Medicine> {
    return this.http.post<Medicine>(`${API_URL}/medicines`, payload);
  }

  updateMedicine(id: number, payload: Record<string, unknown>): Observable<Medicine> {
    return this.http.put<Medicine>(`${API_URL}/medicines/${id}`, payload);
  }

  updateMedicineOrderStatus(id: number, status: string, orderedDate?: string, distributorId?: number, orderedQuantity?: number): Observable<Medicine> {
    return this.http.put<Medicine>(`${API_URL}/medicines/${id}/order-status`, {
      status,
      orderedDate,
      distributorId,
      orderedQuantity
    });
  }

  receiveBatch(payload: Record<string, unknown>): Observable<Batch> {
    return this.http.post<Batch>(`${API_URL}/batches`, payload);
  }

  updateBatch(id: number, payload: Record<string, unknown>): Observable<Batch> {
    return this.http.put<Batch>(`${API_URL}/batches/${id}`, payload);
  }

  distributors(): Observable<Distributor[]> {
    return this.http.get<Distributor[]>(`${API_URL}/distributors`);
  }

  createDistributor(payload: Record<string, unknown>): Observable<Distributor> {
    return this.http.post<Distributor>(`${API_URL}/distributors`, payload);
  }

  updateDistributor(id: number, payload: Record<string, unknown>): Observable<Distributor> {
    return this.http.put<Distributor>(`${API_URL}/distributors/${id}`, payload);
  }

  customers(): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${API_URL}/customers`);
  }

  createCustomer(payload: Record<string, unknown>): Observable<Customer> {
    return this.http.post<Customer>(`${API_URL}/customers`, payload);
  }

  updateCustomer(id: number, payload: Record<string, unknown>): Observable<Customer> {
    return this.http.put<Customer>(`${API_URL}/customers/${id}`, payload);
  }

  createSale(payload: Record<string, unknown>): Observable<Sale> {
    return this.http.post<Sale>(`${API_URL}/sales`, payload);
  }

  credits(): Observable<Credit[]> {
    return this.http.get<Credit[]>(`${API_URL}/credits/outstanding`);
  }

  payCredit(creditId: number, amount: number, paymentMode?: string, referenceNo?: string): Observable<Credit> {
    return this.http.post<Credit>(`${API_URL}/credits/payment`, {
      creditId,
      amount,
      paymentMode: paymentMode || 'CASH',
      referenceNo: referenceNo || ''
    });
  }

  distributorBills(distributorId: number): Observable<DistributorBillView[]> {
    return this.http.get<DistributorBillView[]>(`${API_URL}/distributors/${distributorId}/bills`);
  }

  distributorBill(billId: number): Observable<DistributorBillView> {
    return this.http.get<DistributorBillView>(`${API_URL}/distributors/bills/${billId}`);
  }

  allDistributorBills(): Observable<DistributorBillView[]> {
    return this.http.get<DistributorBillView[]>(`${API_URL}/distributors/bills`);
  }

  distributorPayments(distributorId: number): Observable<DistributorPaymentView[]> {
    return this.http.get<DistributorPaymentView[]>(`${API_URL}/distributors/${distributorId}/payments`);
  }

  payDistributorBill(payload: Record<string, unknown>): Observable<DistributorBillView> {
    return this.http.post<DistributorBillView>(`${API_URL}/distributors/payments`, payload);
  }

  uploadBulkBill(payload: Record<string, unknown>): Observable<DistributorBillView> {
    return this.http.post<DistributorBillView>(`${API_URL}/distributors/bills/bulk`, payload);
  }

  deleteDistributorBill(id: number): Observable<void> {
    return this.http.delete<void>(`${API_URL}/distributors/bills/${id}`);
  }

  getSaleByBillNo(billNo: string): Observable<Sale> {
    return this.http.get<Sale>(`${API_URL}/sales/bill/${billNo}`);
  }

  getCustomerCredits(customerId: number): Observable<Credit[]> {
    return this.http.get<Credit[]>(`${API_URL}/customers/${customerId}/credits`);
  }

  sales(): Observable<Sale[]> {
    return this.http.get<Sale[]>(`${API_URL}/sales`);
  }

  settledCredits(): Observable<Credit[]> {
    return this.http.get<Credit[]>(`${API_URL}/credits/settled`);
  }

  allCredits(): Observable<Credit[]> {
    return this.http.get<Credit[]>(`${API_URL}/credits/all`);
  }

  seedTestCreditCustomers(): Observable<{ status: string; seededBills: number; message: string }> {
    return this.http.post<{ status: string; seededBills: number; message: string }>(`${API_URL}/credits/seed-test-data`, {});
  }

  // New API methods
  analytics(days: number = 30, startDate?: string, endDate?: string): Observable<Analytics> {
    let url = `${API_URL}/analytics?days=${days}`;
    if (startDate !== undefined) {
      url += `&startDate=${startDate}`;
    }
    if (endDate !== undefined) {
      url += `&endDate=${endDate}`;
    }
    return this.http.get<Analytics>(url);
  }

  distributorComparison(): Observable<DistributorPriceComparison[]> {
    return this.http.get<DistributorPriceComparison[]>(`${API_URL}/distributor-comparison`);
  }

  activityLogs(): Observable<ActivityLogEntry[]> {
    return this.http.get<ActivityLogEntry[]>(`${API_URL}/activity-logs`);
  }

  getStoreConfig(): Observable<any> {
    return this.http.get<any>(`${API_URL}/settings/store-config`);
  }

  saveStoreConfig(payload: any): Observable<any> {
    return this.http.post<any>(`${API_URL}/settings/store-config`, payload);
  }

  sendWhatsAppInvoice(saleId: number, pdfBase64?: string, filename?: string): Observable<void> {
    return this.http.post<void>(`${API_URL}/sales/${saleId}/send-whatsapp`, { pdfBase64, filename });
  }

  sendCreditReminder(creditId: number): Observable<void> {
    return this.http.post<void>(`${API_URL}/credits/${creditId}/send-reminder`, {});
  }

  triggerDailyReminders(): Observable<void> {
    return this.http.post<void>(`${API_URL}/settings/whatsapp/trigger-reminders`, {});
  }

  getUsers(): Observable<UserView[]> {
    return this.http.get<UserView[]>(`${API_URL}/users`);
  }

  createUser(payload: Record<string, any>): Observable<UserView> {
    return this.http.post<UserView>(`${API_URL}/users`, payload);
  }

  updateUser(id: number, payload: Record<string, any>): Observable<UserView> {
    return this.http.put<UserView>(`${API_URL}/users/${id}`, payload);
  }

  resetUserPassword(id: number, payload: Record<string, any>): Observable<UserView> {
    return this.http.put<UserView>(`${API_URL}/users/${id}/reset-password`, payload);
  }

  toggleUserActive(id: number, active: boolean): Observable<UserView> {
    return this.http.put<UserView>(`${API_URL}/users/${id}/toggle-active?active=${active}`, {});
  }

  sendDeleteUserOtp(id: number): Observable<void> {
    return this.http.post<void>(`${API_URL}/users/${id}/delete-otp`, {});
  }

  deleteUser(id: number, otp: string): Observable<void> {
    return this.http.delete<void>(`${API_URL}/users/${id}?otp=${otp}`);
  }

  sendRegistrationOtp(payload: { username: string; mobile: string; email: string }): Observable<void> {
    return this.http.post<void>(`${API_URL}/auth/register/otp`, payload);
  }

  register(payload: Record<string, any>): Observable<UserView> {
    return from(this.encryptValue(payload['password'])).pipe(
      switchMap(encryptedPassword => {
        const securePayload = { ...payload, password: encryptedPassword };
        return this.http.post<UserView>(`${API_URL}/auth/register`, securePayload);
      })
    );
  }

  sendUpdateMobileOtp(id: number, mobile: string): Observable<void> {
    return this.http.post<void>(`${API_URL}/users/${id}/update-mobile-otp?mobile=${mobile}`, {});
  }

  forgotPassword(payload: { username: string; mobile: string }): Observable<void> {
    return this.http.post<void>(`${API_URL}/auth/forgot-password`, payload);
  }

  forceChangePassword(payload: { username: string; temporaryPassword: string; newPassword: string }): Observable<LoginResponse> {
    return from(Promise.all([
      this.encryptValue(payload.temporaryPassword),
      this.encryptValue(payload.newPassword)
    ])).pipe(
      switchMap(([encryptedTemp, encryptedNew]) =>
        this.http.post<LoginResponse>(`${API_URL}/auth/force-change-password`, {
          username: payload.username,
          temporaryPassword: encryptedTemp,
          newPassword: encryptedNew
        })
      )
    );
  }

  searchAiPharmacist(medicine: string): Observable<AiPharmacistResponse> {
    return this.http.get<any>(`${API_URL}/ai-pharmacist/search?medicine=${encodeURIComponent(medicine)}`).pipe(
      map(res => {
        if (typeof res === 'string') {
          return JSON.parse(res);
        }
        return res;
      })
    );
  }

  translateAiPharmacist(detailsJson: string, targetLanguage: string): Observable<AiPharmacistResponse> {
    return this.http.post<any>(`${API_URL}/ai-pharmacist/translate`, { detailsJson, targetLanguage }).pipe(
      map(res => {
        if (typeof res === 'string') {
          return JSON.parse(res);
        }
        return res;
      })
    );
  }
}
