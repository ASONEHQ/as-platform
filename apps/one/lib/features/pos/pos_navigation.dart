import 'package:flutter/material.dart';

enum PosModule {
  dashboard('Dashboard', Icons.dashboard_outlined, 'Inicio'),
  pos('Punto de Venta', Icons.point_of_sale_outlined, 'Operación'),
  cafeteria('Cafetería', Icons.local_cafe_outlined, 'Operación'),
  suspended('Ventas Suspendidas', Icons.pause_circle_outline, 'Operación'),
  returns('Devoluciones', Icons.assignment_return_outlined, 'Operación'),
  products('Productos', Icons.inventory_2_outlined, 'Catálogo'),
  categories('Categorías', Icons.category_outlined, 'Catálogo'),
  suppliers('Proveedores', Icons.local_shipping_outlined, 'Catálogo'),
  inventory('Inventario', Icons.warehouse_outlined, 'Inventario'),
  purchases('Compras', Icons.shopping_bag_outlined, 'Inventario'),
  customers('Clientes', Icons.people_outline, 'Relaciones'),
  events('Fiestas', Icons.celebration_outlined, 'Relaciones'),
  memberships('Membresías', Icons.card_membership_outlined, 'Relaciones'),
  promotions('Cupones / Promos', Icons.local_offer_outlined, 'Relaciones'),
  cash('Corte de Caja', Icons.account_balance_wallet_outlined, 'Operación'),
  billing('Facturación CFDI', Icons.receipt_long_outlined, 'Administración'),
  reports('Reportes', Icons.analytics_outlined, 'Administración'),
  access('Control Acceso', Icons.qr_code_scanner_outlined, 'Relaciones'),
  users('Usuarios', Icons.manage_accounts_outlined, 'Administración'),
  employees('Empleados', Icons.badge_outlined, 'Administración'),
  history('Historial de Ventas', Icons.history_outlined, 'Operación'),
  documents('Documentos', Icons.folder_outlined, 'Administración'),
  sync('Sincronización', Icons.sync_outlined, 'Sistema'),
  notifications('Notificaciones', Icons.notifications_outlined, 'Sistema'),
  settings('Configuración', Icons.settings_outlined, 'Sistema');

  const PosModule(this.label, this.icon, this.group);
  final String label;
  final IconData icon;
  final String group;

  bool get implementedReadOnly => const {
    PosModule.dashboard,
    PosModule.products,
    PosModule.inventory,
    PosModule.users,
  }.contains(this);
}

const posNavigationGroups = [
  'Inicio',
  'Operación',
  'Catálogo',
  'Inventario',
  'Relaciones',
  'Administración',
  'Sistema',
];
