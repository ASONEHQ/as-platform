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
  // TASK 14.5 (Wave 3, Phase 7, Item 3): manage MULTIPLE real variants
  // per product (the single `default_variant` alone isn't the full
  // picture) — see `pos_product_variants_screen.dart`.
  productVariants('Variantes', Icons.style_outlined, 'Catálogo'),
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
  settings('Configuración', Icons.settings_outlined, 'Sistema'),
  // TASK 14.5 (Wave 3, Phase 8): per-tenant receipt header/footer text —
  // see `pos_receipt_branding_screen.dart`.
  receiptBranding('Marca del Ticket', Icons.receipt_long_outlined, 'Sistema'),
  // TASK 14.5 (Wave 3, Phase 7, Item 6): a faithful, real port of the
  // legacy's local keyword/regex FAQ bot — see `pos_assistant_screen.dart`.
  assistant('Asistente', Icons.smart_toy_outlined, 'Sistema');

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
    // TASK 13.0: Clientes — customer directory (search/list/detail/create/
    // edit), plus each customer's own Membresías/Rewards/Ventas recientes
    // sections — see ADR-0017 and `pos_customers_gateway.dart`.
    PosModule.customers,
    // TASK 13.0: Membresías — membership plan admin (list/create/edit);
    // a customer's own issued memberships live in Customer Detail instead
    // of a second, duplicate list here.
    PosModule.memberships,
    // TASK 14.3 Wave 1 Part A: Fiestas — real, backend-wired reservation
    // list/calendar/quoting tool/room+package admin — see
    // `pos_parties_gateway.dart` and `docs/LEGACY_FIESTAS_RECOVERY.md`.
    PosModule.events,
    // TASK 14.3 Wave 1 Part B.1: Ventas Suspendidas — real, backend-
    // persisted held-cart suspend/list/resume/discard — see
    // `pos_held_sales_gateway.dart`.
    PosModule.suspended,
    // TASK 14.3 Wave 1 Part C: Compras — "Compra Directa" (direct
    // purchase / quick restock) form plus its real history — see
    // `pos_purchasing_gateway.dart`.
    PosModule.purchases,
    // TASK 14.4 (Wave 2, Part C.1): Proveedores — real supplier directory
    // (list/create/edit/deactivate), company-scoped — see
    // `pos_suppliers_gateway.dart`/`pos_suppliers_screen.dart`.
    PosModule.suppliers,
    // TASK 14.4 (Wave 2, Part D): Reportes — real Report Center across
    // Ventas/Financiero/Inventario/Clientes/Empleados/Fiestas/Accesos,
    // gated by report.read — see
    // `pos_reports_gateway.dart`/`pos_reports_screen.dart`.
    PosModule.reports,
    // TASK 14.4 (Wave 2, Part E): Control de Acceso — real credential
    // issue/scan/void, currently-inside list, event history, and
    // server-side occupancy count; replaces the legacy's own fake ticket
    // scanner — see `pos_access_gateway.dart`/`pos_access_screen.dart`.
    PosModule.access,
    // TASK 14.4 (Wave 2, Part B): Empleados/Horarios/Checador/Nómina —
    // see `pos_people_gateway.dart`/`pos_people_screen.dart`.
    PosModule.employees,
    // TASK 14.5 (Wave 3, Phase 8): Marca del Ticket — per-tenant receipt
    // header/footer text — see `pos_receipt_branding_screen.dart`.
    PosModule.receiptBranding,
    // TASK 14.5 (Wave 3, Phase 7, Item 6): Asistente — real deterministic
    // FAQ bot over live data — see `pos_assistant_screen.dart`.
    PosModule.assistant,
    // TASK 14.5 (Wave 3, Phase 7, Item 3): Variantes — see
    // `pos_product_variants_screen.dart`.
    PosModule.productVariants,
    // TASK 14.5 (Wave 3, Phase 6): Cafetería ("Acceso rápido") — the same
    // real `_PosSale` sale surface as `PosModule.pos`, scoped to whatever
    // categories a company opted into the generic `visualTile` display
    // hint (forensically confirmed to be the legacy's own `estiloCafe`
    // flag's real, purely-visual scope — see
    // `docs/LEGACY_FUNCTIONAL_PARITY.md` §1) — never a second,
    // disconnected sale screen.
    PosModule.cafeteria,
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
