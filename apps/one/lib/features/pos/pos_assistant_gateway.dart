/// TASK 12.2: the Flutter side of `assistant.routes.ts` — "Asistente", a
/// faithful real port of the legacy AS POS V1 local keyword/regex FAQ
/// bot (`docs/LEGACY_FUNCTIONAL_PARITY.md` §21), now over this platform's
/// own real data. Mirrors `pos_reports_gateway.dart`'s own established
/// three-class shape exactly (abstract interface / `Api...` / `Empty...`).
///
/// Every field name below is copied verbatim from `assistant.routes.ts`'s
/// own `assistantAnswerHttp(...)` mapper in
/// `apps/api/src/modules/assistant/assistant.routes.ts` — never guessed.
library;

import '../../core/networking/api_client.dart';

/// Mirrors `AssistantAnswer` (`assistant.types.ts`) exactly. `data` stays
/// a raw, untyped `Map` (unlike the Reports gateway's fully-typed report
/// models) — this endpoint's `data` shape genuinely varies per intent
/// (sales totals vs. a boolean vs. a count), so this model never invents
/// one unified shape for all of them; a caller that wants a specific
/// field reads it straight off `data` by its own real backend key.
class PosAssistantAnswer {
  const PosAssistantAnswer({
    required this.intent,
    required this.question,
    required this.answerText,
    required this.data,
  });

  factory PosAssistantAnswer.fromJson(Map<String, Object?> json) => PosAssistantAnswer(
    intent: json['intent']! as String,
    question: json['question']! as String,
    answerText: json['answer_text']! as String,
    data: json['data'] as Map<String, Object?>?,
  );

  final String intent;
  final String question;
  final String answerText;
  final Map<String, Object?>? data;
}

abstract interface class PosAssistantGateway {
  /// `POST /api/v1/assistant/query`. `branchId`, when supplied, is the
  /// same optional real branch narrowing every other gateway call in this
  /// app already exposes — the backend still enforces
  /// `requireBranchAccess` for it.
  Future<PosAssistantAnswer> ask(String question, {String? branchId});
}

class ApiPosAssistantGateway implements PosAssistantGateway {
  const ApiPosAssistantGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosAssistantAnswer> ask(String question, {String? branchId}) async {
    final envelope = await _client.postJson(
      '/api/v1/assistant/query',
      body: {'question': question, if (branchId != null) 'branch_id': branchId},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing assistant answer data.');
    }
    return PosAssistantAnswer.fromJson(data);
  }
}

class EmptyPosAssistantGateway implements PosAssistantGateway {
  const EmptyPosAssistantGateway();

  @override
  Future<PosAssistantAnswer> ask(String question, {String? branchId}) =>
      Future.error(StateError('No assistant gateway is configured.'));
}
