import { create } from 'zustand';

export interface CartItem {
  id: string;
  itemId: number | null;
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface HeldBill {
  id: string;
  label: string;
  heldAt: number;
  cart: CartItem[];
  discount: number;
  paymentType: 'CASH' | 'CARD' | 'UDHAAR';
  selectedCustomer: { id: number; name: string; phone: string } | null;
  cashTendered: number;
}

interface BillingStore {
  cart: CartItem[];
  discount: number;
  paymentType: 'CASH' | 'CARD' | 'UDHAAR';
  selectedCustomer: { id: number; name: string; phone: string } | null;
  heldBills: HeldBill[];
  cashTendered: number;
  addItem: (item: Omit<CartItem, 'id' | 'total'>) => void;
  removeItem: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  incrementQty: (id: string, delta: number) => void;
  updatePrice: (id: string, price: number) => void;
  updateName: (id: string, name: string) => void;
  setDiscount: (d: number) => void;
  setPaymentType: (t: 'CASH' | 'CARD' | 'UDHAAR') => void;
  setCustomer: (c: { id: number; name: string; phone: string } | null) => void;
  setCashTendered: (amount: number) => void;
  clearCart: () => void;
  holdCurrent: (label: string) => void;
  resumeHeld: (id: string) => void;
  removeHeld: (id: string) => void;
  subtotal: () => number;
  grandTotal: () => number;
  changeDue: () => number;
}

export const useBillingStore = create<BillingStore>((set, get) => ({
  cart: [],
  discount: 0,
  paymentType: 'CASH',
  selectedCustomer: null,
  heldBills: [],
  cashTendered: 0,

  addItem: (item) =>
    set((state) => {
      const existing = state.cart.find(
        (c) => c.itemId && c.itemId === item.itemId
      );
      if (existing) {
        return {
          cart: state.cart.map((c) =>
            c.id === existing.id
              ? { ...c, quantity: c.quantity + item.quantity, total: (c.quantity + item.quantity) * c.price }
              : c
          ),
        };
      }
      const newItem: CartItem = {
        ...item,
        id: `${Date.now()}-${Math.random()}`,
        total: item.quantity * item.price,
      };
      return { cart: [...state.cart, newItem] };
    }),

  removeItem: (id) =>
    set((state) => ({ cart: state.cart.filter((c) => c.id !== id) })),

  updateQty: (id, qty) =>
    set((state) => ({
      cart: state.cart.map((c) =>
        c.id === id ? { ...c, quantity: qty, total: qty * c.price } : c
      ),
    })),

  incrementQty: (id, delta) =>
    set((state) => ({
      cart: state.cart
        .map((c) => (c.id === id ? { ...c, quantity: Math.max(0, c.quantity + delta), total: Math.max(0, c.quantity + delta) * c.price } : c))
        .filter((c) => c.quantity > 0),
    })),

  updatePrice: (id, price) =>
    set((state) => ({
      cart: state.cart.map((c) =>
        c.id === id ? { ...c, price, total: c.quantity * price } : c
      ),
    })),

  updateName: (id, name) =>
    set((state) => ({
      cart: state.cart.map((c) =>
        c.id === id ? { ...c, name } : c
      ),
    })),

  setDiscount: (d) => set({ discount: d }),
  setPaymentType: (t) => set({ paymentType: t, cashTendered: 0 }),
  setCustomer: (c) => set({ selectedCustomer: c }),
  setCashTendered: (amount) => set({ cashTendered: amount }),

  clearCart: () =>
    set({ cart: [], discount: 0, paymentType: 'CASH', selectedCustomer: null, cashTendered: 0 }),

  holdCurrent: (label) =>
    set((state) => {
      if (state.cart.length === 0) return state;
      const held: HeldBill = {
        id: `${Date.now()}-${Math.random()}`,
        label: label || `Bill ${state.heldBills.length + 1}`,
        heldAt: Date.now(),
        cart: state.cart,
        discount: state.discount,
        paymentType: state.paymentType,
        selectedCustomer: state.selectedCustomer,
        cashTendered: state.cashTendered,
      };
      return {
        heldBills: [...state.heldBills, held],
        cart: [],
        discount: 0,
        paymentType: 'CASH',
        selectedCustomer: null,
        cashTendered: 0,
      };
    }),

  resumeHeld: (id) =>
    set((state) => {
      const held = state.heldBills.find((h) => h.id === id);
      if (!held) return state;
      return {
        cart: held.cart,
        discount: held.discount,
        paymentType: held.paymentType,
        selectedCustomer: held.selectedCustomer,
        cashTendered: held.cashTendered,
        heldBills: state.heldBills.filter((h) => h.id !== id),
      };
    }),

  removeHeld: (id) => set((state) => ({ heldBills: state.heldBills.filter((h) => h.id !== id) })),

  subtotal: () => get().cart.reduce((s, i) => s + i.total, 0),
  grandTotal: () => Math.max(0, get().subtotal() - get().discount),
  changeDue: () => Math.max(0, get().cashTendered - get().grandTotal()),
}));
