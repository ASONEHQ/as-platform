import 'package:flutter/material.dart';

// Group names, membership, and order match the canonical `.sb-group-header`
// / `.sb-item[data-nav]` structure in `AS POS V1.html` exactly (Ventas,
// Catálogo, Inventario, Clientes, Caja y Finanzas, Administración, Sistema)
// — not an app-specific reinterpretation.
enum PosModule {
  pos('Punto de Venta', Icons.point_of_sale_outlined, 'Ventas'),
  cafeteria('Cafetería', Icons.local_cafe_outlined, 'Ventas'),
  suspended('Ventas Suspendidas', Icons.pause_circle_outline, 'Ventas'),
  returns('Devoluciones', Icons.assignment_return_outlined, 'Ventas'),
  products('Productos', Icons.inventory_2_outlined, 'Catálogo'),
  categories('Categorías', Icons.category_outlined, 'Catálogo'),
  suppliers('Proveedores', Icons.local_shipping_outlined, 'Catálogo'),
  inventory('Inventario', Icons.warehouse_outlined, 'Inventario'),
  purchases('Compras', Icons.shopping_bag_outlined, 'Inventario'),
  customers('Clientes', Icons.people_outline, 'Clientes'),
  events('Fiestas', Icons.celebration_outlined, 'Clientes'),
  memberships('Membresías', Icons.card_membership_outlined, 'Clientes'),
  promotions('Cupones / Promos', Icons.local_offer_outlined, 'Clientes'),
  cash('Corte de Caja', Icons.account_balance_wallet_outlined, 'Caja y Finanzas'),
  billing('Facturación CFDI', Icons.receipt_long_outlined, 'Caja y Finanzas'),
  dashboard('Dashboard', Icons.dashboard_outlined, 'Administración'),
  reports('Reportes', Icons.analytics_outlined, 'Administración'),
  access('Control Acceso', Icons.qr_code_scanner_outlined, 'Administración'),
  users('Usuarios', Icons.manage_accounts_outlined, 'Administración'),
  employees('Empleados', Icons.badge_outlined, 'Administración'),
  history('Historial de Ventas', Icons.history_outlined, 'Administración'),
  documents('Documentos', Icons.folder_outlined, 'Sistema'),
  sync('Sincronización', Icons.sync_outlined, 'Sistema'),
  notifications('Notificaciones', Icons.notifications_outlined, 'Sistema'),
  settings('Configuración', Icons.settings_outlined, 'Sistema');

  const PosModule(this.label, this.icon, this.group);
  final String label;
  final IconData icon;
  final String group;

  bool get implementedReadOnly => const {
    PosModule.dashboard,
    PosModule.pos,
    PosModule.products,
    PosModule.inventory,
    PosModule.users,
    // TASK 12.6 Part C.
    PosModule.history,
    // TASK 12.8: Devoluciones — a real, backend-paginated refund history
    // list (E084), plus the Sale Detail "Devolver / Reembolsar" mutating
    // action reached from Historial de ventas — mirrors `PosModule.pos`/
    // `PosModule.cash`, both of which are also "implemented" screens that
    // contain a mutating action, not merely a read-only view.
    PosModule.returns,
    // TASK 12.9: Cupones / Promos — real, backend-paginated promotion/
    // coupon admin management (list/create/edit) — mirrors
    // `PosModule.returns`/`PosModule.cash` exactly, both of which are also
    // "implemented" screens containing a mutating action, not merely a
    // read-only view.
    PosModule.promotions,
  }.contains(this);
}

const posNavigationGroups = [
  'Ventas',
  'Catálogo',
  'Inventario',
  'Clientes',
  'Caja y Finanzas',
  'Administración',
  'Sistema',
];

/// Matches each `.sb-group-header`'s own icon in the canonical sidebar —
/// V1 reuses the group's icon on its primary item too (e.g. Ventas /
/// Punto de Venta both use `ti-shopping-cart`).
IconData posGroupIcon(String group) => switch (group) {
  'Ventas' => Icons.shopping_cart_outlined,
  'Catálogo' => Icons.inventory_2_outlined,
  'Inventario' => Icons.inventory_outlined,
  'Clientes' => Icons.people_outline,
  'Caja y Finanzas' => Icons.payments_outlined,
  'Administración' => Icons.dashboard_outlined,
  'Sistema' => Icons.settings_outlined,
  _ => Icons.folder_outlined,
};
