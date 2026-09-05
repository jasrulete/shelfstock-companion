export type UserRole = 'customer' | 'admin';

export interface PublicUser {
  id: number;
  email: string;
  role: UserRole;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string; // pg NUMERIC serializes as string
  category: string;
  stock: number;
  image_url: string | null;
  barcode: string | null;
  created_at: string;
}

/** One row of the server's stock ledger. `source` says which path moved the number. */
export interface StockAdjustment {
  id: number;
  delta: number;
  new_stock: number;
  source: 'web-admin' | 'companion' | 'order' | 'cancel';
  note: string | null;
  created_at: string;
}

export type OrderStatus = 'pending' | 'shipped' | 'completed' | 'cancelled';

export interface Order {
  id: number;
  user_id: number;
  total_amount: string;
  currency: string;
  status: OrderStatus;
  payment_method: string;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  created_at: string;
  /**
   * The statuses the server will accept next, served on every order payload
   * (ADR-0007). Optional only because a server older than that decision sends
   * nothing; `transitionsFor()` falls back and says so.
   */
  allowed_transitions?: OrderStatus[];
}

export interface OrderListItem extends Order {
  user_email: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  price_at_purchase: string;
  product_name: string;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
}

export interface Paginated<T> {
  pagination: { page: number; limit: number; total: number; totalPages: number };
  // list key differs per endpoint; endpoints declare their own full shape
  [key: string]: unknown;
}

export interface OrdersListResponse {
  orders: OrderListItem[];
  pagination: Paginated<never>['pagination'];
}

export interface ProductsListResponse {
  products: Product[];
  pagination: Paginated<never>['pagination'];
}
