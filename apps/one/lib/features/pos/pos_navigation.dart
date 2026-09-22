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
  // TASK 15.1 Phase 4: real brand admin (list/create/edit) — see
  // `pos_brand_admin_screen.dart`.
  brands('Marcas', Icons.sell_outlined, 'Catálogo'),
  suppliers('Proveedores', Icons.local_shipping_outlined, 'Catálogo'),
  // TASK 15.1 Phase 4: branch price overrides, custom options/variant
  // barcodes, and catalog CSV export — the "catalog admin depth" gap —
  // see `pos_catalog_admin_screen.dart`.
  catalogAdmin('Catálogo Avanzado', Icons.tune_outlined, 'Catálogo'),
  inventory('Inventario', Icons.warehouse_outlined, 'Inventario'),
  purchases('Compras', Icons.shopping_bag_outlined, 'Inventario'),
  // TASK 15.1 Phase 3: movement drafts/adjustments, branch transfers,
  // physical counts, reservations, reconciliation, and locations — the
  // six-inventory-sub-domain gap — see `pos_inventory_admin_screen.dart`.
  inventoryAdmin('Admin. Inventario', Icons.rule_folder_outlined, 'Inventario'),
  customers('Clientes', Icons.people_outline, 'Clientes'),
  events('Fiestas', Icons.celebration_outlined, 'Clientes'),
  memberships('Membresías', Icons.card_membership_outlined, 'Clientes'),
  promotions('Cupones / Promos', Icons.local_offer_outlined, 'Clientes'),
  cash('Corte de Caja', Icons.account_balance_wallet_outlined, 'Caja y Finanzas'),
  billing('Facturación CFDI', Icons.receipt_long_outlined, 'Caja y Finanzas'),
  // TASK 16.15: "Consolidado de sucursal" — a read-only, branch-wide
  // roll-up across every cash register/operational area for the day,
  // gated by `branch_consolidation.read` — see
  // `pos_branch_consolidation_screen.dart`. Grouped alongside `cash`/
  // `billing` since both are already the established "Caja y Finanzas"
  // group; this task's own brief explicitly asks for Mi caja/Cortes de
  // caja/Consolidado de sucursal grouped there rather than inventing a
  // new group ("Mi caja"/"Cortes de caja" both already live inside
  // `PosModule.cash`'s own screen body — no separate nav entry for
  // either exists today, and this task does not restructure that).
  branchConsolidation(
    'Consolidado de Sucursal',
    Icons.summarize_outlined,
    'Caja y Finanzas',
  ),
  dashboard('Dashboard', Icons.dashboard_outlined, 'Administración'),
  reports('Reportes', Icons.analytics_outlined, 'Administración'),
  access('Control Acceso', Icons.qr_code_scanner_outlined, 'Administración'),
  users('Usuarios', Icons.manage_accounts_outlined, 'Administración'),
  // TASK 15.1 Phase 2: role/permission administration lives inside the
  // same screen as Usuarios (tabs: Usuarios/Roles/Permisos) — see
  // `pos_user_administration_screen.dart`. No separate nav entry needed.
  // TASK 15.1: branch create/edit — see `pos_branch_admin_screen.dart`.
  branches('Sucursales', Icons.store_outlined, 'Administración'),
  // TASK 16.15: "Áreas Operativas" — tenant-defined grouping of cash
  // registers (e.g. one tenant's own "Admisiones/Alimentos/Eventos",
  // another's "Taquilla/Cafetería/Eventos" — always operator-entered,
  // never a hardcoded name here) — see
  // `pos_operational_areas_screen.dart`.
  operationalAreas('Áreas Operativas', Icons.store_mall_directory_outlined, 'Administración'),
  employees('Empleados', Icons.badge_outlined, 'Administración'),
  history('Historial de Ventas', Icons.history_outlined, 'Administración'),
  documents('Documentos', Icons.folder_outlined, 'Sistema'),
  sync('Sincronización', Icons.sync_outlined, 'Sistema'),
  notifications('Notificaciones', Icons.notifications_outlined, 'Sistema'),
  settings('Configuración', Icons.settings_outlined, 'Sistema'),
  // TASK 14.5 (Wave 3, Phase 8): per-tenant receipt header/footer text —
  // see `pos_receipt_branding_screen.dart`.
  receiptBranding('Marca del Ticket', Icons.receipt_long_outlined, 'Sistema'),
  // TASK 16.7B: real thermal-printer paper-width configuration + a
  // zero-side-effect "Imprimir ticket de prueba" — see
  // `pos_printer_settings_screen.dart`.
  printerSettings('Impresora de Tickets', Icons.print_outlined, 'Sistema'),
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
    // categories are classified `operational_group='cafeteria'` (TASK
    // 16.13A) — the SAME authoritative classification Corte Parcial's
    // own Cafetería/Snacks reporting reads, never the unrelated
    // `visualTile` display hint this screen incorrectly used before
    // TASK 16.13A unified the two — see
    // `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.13A section — and
    // never a second, disconnected sale screen.
    PosModule.cafeteria,
    // TASK 15.1 Phase 2-4: real, backend-wired commercial admin UI closing
    // the "functional completeness" YELLOW — see each screen's own file
    // for the specific gap it closes.
    PosModule.brands,
    PosModule.catalogAdmin,
    PosModule.inventoryAdmin,
    PosModule.branches,
    // TASK 16.15: real, backend-wired — see each screen's own file.
    PosModule.branchConsolidation,
    PosModule.operationalAreas,
    // TASK 16.17: Configuración — the tenant readiness / go-live checklist
    // (`GET /api/v1/readiness`) — see `pos_readiness_screen.dart`.
    PosModule.settings,
  }.contains(this);
}

// TASK 16.16 (Phase 5) — "which permission(s) gate this module's own
// sidebar nav item?" A pure, static, capability-derived table: never keyed
// off a role's name/code (see this task's own absolute constraint), only
// off the SAME real permission codes `AuthenticatedContext.permissions`
// already carries. "Any of" semantics — the module is visible when the
// actor holds at least one of the listed codes. `null`/absent means always
// visible (no gate at all — today only [PosModule.assistant]).
//
// This is deliberately a SECOND, independent gate layered on top of each
// screen's own existing internal permission check (see e.g. `_PosSaleState.
// build`'s `catalog.read` check, `_Dashboard.build`'s `report.read` check)
// — defense in depth, not a replacement. The two are allowed to differ:
// a sidebar nav entry answers "does this look like this actor's job?" (a
// commercial/UX framing) while a screen body's own gate answers "is this
// specific read/write technically authorized?" (the real, backend-enforced
// question). `PosModule.pos`/`cafeteria`/`suspended` are the clearest
// example — gated here by `sale.create` (the meaningful "this person can
// ring up a sale" signal) even though the screen body underneath only
// strictly needs `catalog.read` to render the product grid.
//
// Values for not-yet-implemented modules (`cafeteria`/`billing`/
// `documents`/`notifications`) reuse the closest real, already-existing
// permission — there is no dedicated backend permission for any of them
// yet, and this table never invents one.
const Map<PosModule, List<String>> _posModuleRequiredAnyPermission = {
  PosModule.pos: ['sale.create'],
  PosModule.cafeteria: ['sale.create'],
  PosModule.suspended: ['sale.create'],
  PosModule.returns: ['refund.read'],
  PosModule.products: ['catalog.read'],
  PosModule.productVariants: ['catalog.read'],
  PosModule.categories: ['catalog.read'],
  PosModule.brands: ['catalog.read'],
  PosModule.suppliers: ['supplier.read'],
  PosModule.catalogAdmin: ['catalog.read'],
  PosModule.inventory: ['inventory.read'],
  PosModule.purchases: ['purchase.read'],
  PosModule.inventoryAdmin: ['inventory.read'],
  PosModule.customers: ['customer.read'],
  PosModule.events: ['party.read'],
  PosModule.memberships: ['membership.read'],
  PosModule.promotions: ['promotion.read', 'coupon.read'],
  PosModule.cash: ['cash_session.read'],
  PosModule.billing: ['cash_session.read'],
  PosModule.branchConsolidation: ['branch_consolidation.read'],
  PosModule.dashboard: ['report.read'],
  PosModule.reports: ['report.read'],
  PosModule.access: ['access.read'],
  PosModule.users: ['user.read'],
  PosModule.branches: ['branch.read'],
  PosModule.operationalAreas: ['operational_area.read'],
  PosModule.employees: ['employee.read'],
  PosModule.history: ['sale.read'],
  PosModule.documents: ['company_settings.read'],
  PosModule.sync: ['sync.execute'],
  PosModule.notifications: ['company_settings.read'],
  // TASK 16.17: gated by the readiness endpoint's own guard.
  PosModule.settings: ['branch.read'],
  PosModule.receiptBranding: ['company_settings.read'],
  PosModule.printerSettings: ['company_settings.read'],
  // `PosModule.assistant` intentionally absent — always visible, matching
  // `pos_assistant_screen.dart`'s own deliberate zero-permission-check
  // design (see this map's own header doc comment).
};

extension PosModuleAccess on PosModule {
  /// The permission code(s) gating this module's own sidebar nav item —
  /// `null`/empty means always visible. See
  /// [_posModuleRequiredAnyPermission]'s own doc comment for the full rule.
  List<String>? get requiredAnyPermission => _posModuleRequiredAnyPermission[this];
}

/// `true` when [permissions] holds at least one of [module]'s own
/// [PosModuleAccess.requiredAnyPermission] codes (or that module has no
/// gate at all). Extracted as a plain function — not a method on a widget
/// — so it's testable without building any UI, mirroring
/// `resolvePosRegisterScope`'s own precedent in `pos_register_scope.dart`.
bool posModuleVisibleFor(PosModule module, List<String> permissions) {
  final required = module.requiredAnyPermission;
  if (required == null || required.isEmpty) return true;
  return required.any(permissions.contains);
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
