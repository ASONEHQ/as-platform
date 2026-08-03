import 'package:flutter/material.dart';

import '../tokens/as_tokens.dart';

class AsPrimaryButton extends StatelessWidget {
  const AsPrimaryButton({
    required this.label,
    required this.onPressed,
    this.icon,
    super.key,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: FilledButton.icon(
      onPressed: onPressed,
      icon: Icon(icon ?? Icons.arrow_forward_rounded, size: 18),
      label: Text(label),
    ),
  );
}

class AsSecondaryButton extends StatelessWidget {
  const AsSecondaryButton({
    required this.label,
    required this.onPressed,
    super.key,
  });
  final String label;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) =>
      OutlinedButton(onPressed: onPressed, child: Text(label));
}

class AsTextField extends StatelessWidget {
  const AsTextField({
    required this.label,
    this.controller,
    this.keyboardType,
    this.autofillHints,
    this.enabled = true,
    this.onSubmitted,
    super.key,
  });
  final String label;
  final TextEditingController? controller;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;
  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    keyboardType: keyboardType,
    autofillHints: autofillHints,
    enabled: enabled,
    onSubmitted: onSubmitted,
    decoration: InputDecoration(labelText: label),
  );
}

class AsPasswordField extends StatefulWidget {
  const AsPasswordField({
    required this.label,
    this.controller,
    this.enabled = true,
    this.onSubmitted,
    super.key,
  });
  final String label;
  final TextEditingController? controller;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;
  @override
  State<AsPasswordField> createState() => _AsPasswordFieldState();
}

class _AsPasswordFieldState extends State<AsPasswordField> {
  bool hidden = true;
  @override
  Widget build(BuildContext context) => TextField(
    controller: widget.controller,
    obscureText: hidden,
    enabled: widget.enabled,
    onSubmitted: widget.onSubmitted,
    autofillHints: const [AutofillHints.password],
    decoration: InputDecoration(
      labelText: widget.label,
      suffixIcon: IconButton(
        tooltip: hidden ? 'Mostrar contraseña' : 'Ocultar contraseña',
        onPressed: () => setState(() => hidden = !hidden),
        icon: Icon(
          hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
        ),
      ),
    ),
  );
}

class AsCard extends StatelessWidget {
  const AsCard({
    required this.child,
    this.padding = const EdgeInsets.all(AsSpacing.x6),
    super.key,
  });
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: AsColors.surface,
      border: Border.all(color: AsColors.border),
      borderRadius: BorderRadius.circular(AsRadius.large),
      boxShadow: AsShadows.card,
    ),
    child: child,
  );
}

class AsStatusBadge extends StatelessWidget {
  const AsStatusBadge({
    required this.label,
    this.color = AsColors.info,
    super.key,
  });
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Estado: $label',
    child: Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AsSpacing.x3,
        vertical: AsSpacing.x2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(AsRadius.pill),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontWeight: FontWeight.w700),
      ),
    ),
  );
}

class AsLoadingIndicator extends StatelessWidget {
  const AsLoadingIndicator({this.label = 'Cargando', super.key});
  final String label;
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: label,
    child: const SizedBox.square(
      dimension: 32,
      child: CircularProgressIndicator(strokeWidth: 3),
    ),
  );
}

class AsEmptyState extends StatelessWidget {
  const AsEmptyState({
    required this.title,
    required this.message,
    this.icon = Icons.inbox_outlined,
    super.key,
  });
  final String title;
  final String message;
  final IconData icon;
  @override
  Widget build(BuildContext context) =>
      _StatePanel(icon: icon, title: title, message: message);
}

class AsErrorState extends StatelessWidget {
  const AsErrorState({
    required this.title,
    required this.message,
    this.onRetry,
    super.key,
  });
  final String title;
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => _StatePanel(
    icon: Icons.error_outline_rounded,
    title: title,
    message: message,
    action: onRetry == null
        ? null
        : AsSecondaryButton(label: 'Reintentar', onPressed: onRetry),
  );
}

class _StatePanel extends StatelessWidget {
  const _StatePanel({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      container: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 44, color: AsColors.primary),
          const SizedBox(height: AsSpacing.x4),
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: AsSpacing.x2),
          Text(message, textAlign: TextAlign.center),
          if (action != null) ...[
            const SizedBox(height: AsSpacing.x4),
            action!,
          ],
        ],
      ),
    ),
  );
}

class AsPageHeader extends StatelessWidget {
  const AsPageHeader({
    required this.title,
    required this.description,
    this.trailing,
    super.key,
  });
  final String title;
  final String description;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: AsSpacing.x2),
            Text(description),
          ],
        ),
      ),
      ?trailing,
    ],
  );
}

class AsAppLogo extends StatelessWidget {
  const AsAppLogo({this.compact = false, this.onDark = false, super.key});
  final bool compact;
  final bool onDark;
  @override
  Widget build(BuildContext context) => Semantics(
    image: true,
    label: 'AS ONE',
    child: Text(
      compact ? 'AS' : 'AS ONE',
      style: Theme.of(context).textTheme.titleLarge?.copyWith(
        color: onDark ? Colors.white : AsColors.primaryDark,
        fontWeight: FontWeight.w800,
        letterSpacing: 1.4,
      ),
    ),
  );
}

class AsContextChip extends StatelessWidget {
  const AsContextChip({required this.label, super.key});
  final String label;
  @override
  Widget build(BuildContext context) => Chip(
    avatar: const Icon(Icons.apartment_rounded, size: 18),
    label: Text(label),
  );
}
