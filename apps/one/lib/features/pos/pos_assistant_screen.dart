/// TASK 12.2: "Asistente" — a faithful real port of the legacy AS POS V1
/// local keyword/regex FAQ bot (`docs/LEGACY_FUNCTIONAL_PARITY.md` §21),
/// now answering from this platform's own real data via
/// `assistant.routes.ts`/`pos_assistant_gateway.dart`. No LLM, no
/// simulated typing effect, no fabricated confidence score — the answer
/// shown is exactly the real Spanish sentence the backend's deterministic
/// matcher built from a real query, rendered verbatim.
///
/// No l10n (hardcoded Spanish strings, matching the rest of this app), no
/// Riverpod/Bloc (`StatefulWidget`+`setState`), and visual consistency via
/// `PosPalette.of(context)` only, mirroring `pos_reports_screen.dart`'s
/// own established conventions.
///
/// Reachability: unlike every other POS module screen, this one is NOT
/// wired into `pos_shell.dart`'s module switch by this task (that file is
/// off-limits this wave — see this task's own final report). This widget
/// is instead built as a genuinely standalone, self-contained entry
/// point — a public `StatefulWidget` taking just `{required
/// AuthenticatedContext context, required PosAssistantGateway gateway}` —
/// so the orchestrator can drop it in EITHER as a new
/// `PosModule.assistant` nav destination (the same shape every other
/// module screen already has) OR as a floating action button overlay
/// (e.g. a chat-bubble FAB opening this screen in a bottom sheet/dialog)
/// without this file needing to change either way. This file deliberately
/// favors the FAB/overlay reading: `build()` renders a compact panel (no
/// its own `Scaffold`/app bar) so a caller can embed it inside whichever
/// container it chooses — a full-page nav destination wraps it in a
/// scrolling column exactly like `pos_reports_screen.dart`'s own
/// `_Content` wrapper does for every other module, and a FAB overlay
/// wraps it in a `Dialog`/`BottomSheet` instead — this widget itself does
/// not need to know which.
///
/// Reached by any authenticated user — no permission gate (matches
/// `assistant.routes.ts`'s own `requireAuthenticatedUser`-only gating; see
/// that file's doc comment for the full reasoning: this endpoint invents
/// no new capability, it only surfaces figures the caller's own session
/// can already see elsewhere).
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_assistant_gateway.dart';
import 'pos_tokens.dart';

enum _AssistantPhase { idle, loading, ready, failure }

class PosAssistantScreen extends StatefulWidget {
  const PosAssistantScreen({required this.context, required this.gateway, super.key});

  final AuthenticatedContext context;
  final PosAssistantGateway gateway;

  @override
  State<PosAssistantScreen> createState() => _PosAssistantScreenState();
}

class _PosAssistantScreenState extends State<PosAssistantScreen> {
  final _controller = TextEditingController();
  _AssistantPhase _phase = _AssistantPhase.idle;
  PosAssistantAnswer? _answer;
  String? _errorMessage;

  /// Mirrors `_HeldSales`/`_ReportsScreen`'s own `_branchId` getter
  /// exactly: company-wide access asks across every branch the session
  /// permits (`branchId: null`), never a project-invented "all branches
  /// everywhere" bypass; a branch-scoped session always asks about its
  /// own single branch.
  String? get _branchId => widget.context.companyWideAccess ? null : widget.context.session.branchId;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    final question = _controller.text.trim();
    if (question.isEmpty) return;
    setState(() {
      _phase = _AssistantPhase.loading;
      _errorMessage = null;
    });
    try {
      final answer = await widget.gateway.ask(question, branchId: _branchId);
      if (!mounted) return;
      setState(() {
        _answer = answer;
        _phase = _AssistantPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AssistantPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AssistantPhase.failure;
        _errorMessage = 'No fue posible obtener una respuesta.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.assistant_outlined, size: 20, color: palette.blueDeep),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Asistente',
                  style: TextStyle(color: palette.text, fontSize: 17, fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Pregunta sobre ventas de hoy, si la caja está abierta, stock bajo o fiestas de hoy. '
            'Respuestas reales calculadas por el servidor — sin inteligencia artificial.',
            style: TextStyle(color: palette.textMuted, fontSize: 12),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pos-assistant-question-field'),
                  controller: _controller,
                  decoration: InputDecoration(
                    hintText: '¿Cuántas ventas hubo hoy?',
                    isDense: true,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onSubmitted: (_) => unawaited(_ask()),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                key: const Key('pos-assistant-ask-button'),
                onPressed: () => unawaited(_ask()),
                style: ElevatedButton.styleFrom(backgroundColor: palette.action, foregroundColor: palette.surface),
                child: const Text('Preguntar'),
              ),
            ],
          ),
          const SizedBox(height: 14),
          switch (_phase) {
            _AssistantPhase.idle => const SizedBox.shrink(),
            _AssistantPhase.loading => const _AssistantLoadingState(),
            _AssistantPhase.failure => _AssistantFailureState(
              message: _errorMessage ?? 'No fue posible obtener una respuesta.',
            ),
            _AssistantPhase.ready => _AssistantAnswerView(answer: _answer!),
          },
        ],
      ),
    );
  }
}

class _AssistantLoadingState extends StatelessWidget {
  const _AssistantLoadingState();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 12),
    child: Center(child: CircularProgressIndicator(key: Key('pos-assistant-loading'))),
  );
}

class _AssistantFailureState extends StatelessWidget {
  const _AssistantFailureState({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-assistant-error-state'),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: palette.surface, borderRadius: BorderRadius.circular(8)),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 18, color: palette.blueDeep),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: TextStyle(color: palette.textSecondary, fontSize: 12.5))),
        ],
      ),
    );
  }
}

/// The real answer, exactly as the backend sent it — the matched
/// `intent` is shown as a small honest label (never hidden, even for
/// `unknown`) alongside the real Spanish sentence. `data`, when present,
/// renders as plain `key: value` rows straight off the real backend
/// payload — never a re-derived or fabricated figure.
class _AssistantAnswerView extends StatelessWidget {
  const _AssistantAnswerView({required this.answer});
  final PosAssistantAnswer answer;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final data = answer.data;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: palette.surface, border: Border.all(color: palette.border), borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            key: const Key('pos-assistant-intent-badge'),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: palette.action.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
            child: Text(
              answer.intent,
              style: TextStyle(color: palette.blueDeep, fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            answer.answerText,
            key: const Key('pos-assistant-answer-text'),
            style: TextStyle(color: palette.text, fontSize: 15, fontWeight: FontWeight.w600),
          ),
          if (data != null && data.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final entry in data.entries)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  '${entry.key}: ${entry.value}',
                  style: TextStyle(color: palette.textMuted, fontSize: 11.5),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
