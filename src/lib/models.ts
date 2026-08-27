export interface Item {
  id: number;
  barcode: string | null;
  name: string;
  category: string;
  cost_price: number;
  sale_price: number;
  quantity: number;
  unit: string;
  unit_type: 'COUNT' | 'WEIGHT';
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface StockBatch {
  id: number;
  item_id: number;
  quantity: number;
  cost_price: number;
  expiry_date: string | null;
  purchase_id: number | null;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  address: string;
  balance: number;
  created_at: string;
}

export interface SupplierLedgerEntry {
  id: number;
  supplier_id: number;
  amount: number;
  type: 'PURCHASE' | 'PAYMENT';
  notes: string;
  purchase_id: number | null;
  date: string;
}

export interface Purchase {
  id: number;
  purchase_number: string;
  supplier_id: number | null;
  supplier_name: string;
  payment_type: 'CASH' | 'CREDIT';
  subtotal: number;
  total: number;
  created_at: string;
  items?: PurchaseItem[];
}

export interface PurchaseItem {
  id: number;
  purchase_id: number;
  item_id: number | null;
  name: string;
  quantity: number;
  cost_price: number;
  expiry_date: string | null;
  total: number;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  balance: number;
  created_at: string;
  ledger?: CustomerLedgerEntry[];
}

export interface CustomerLedgerEntry {
  id: number;
  customer_id: number;
  amount: number;
  type: 'CREDIT' | 'PAYMENT';
  bill_id: number | null;
  notes: string;
  date: string;
}

export interface Bill {
  id: number;
  bill_number: string;
  customer_id: number | null;
  customer_name: string;
  payment_type: 'CASH' | 'CARD' | 'UDHAAR';
  subtotal: number;
  discount: number;
  total: number;
  status: 'COMPLETED' | 'RETURNED' | 'PARTIAL_RETURN';
  created_at: string;
  items?: BillItem[];
}

export interface BillItem {
  id: number;
  bill_id: number;
  item_id: number | null;
  name: string;
  quantity: number;
  price: number;
  total: number;
  returned_quantity: number;
  cost_price: number | null;
}

export interface ReturnRecord {
  id: number;
  return_number: string;
  bill_id: number;
  refund_amount: number;
  refund_method: 'CASH' | 'UDHAAR_ADJUST';
  notes: string;
  created_at: string;
}
