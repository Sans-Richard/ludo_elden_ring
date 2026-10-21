"""Deterministic validation and compilation for Quest Rule IR documents."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    path: str
    severity: str = "error"


@dataclass(frozen=True)
class QuestModel:
    schema_version: str
    game_id: str
    quests: tuple[Mapping[str, Any], ...]
    world_variables: tuple[Mapping[str, Any], ...]
    actions: tuple[Mapping[str, Any], ...]
    transitions: tuple[Mapping[str, Any], ...]
    properties: tuple[Mapping[str, Any], ...]


@dataclass(frozen=True)
class CompileResult:
    model: QuestModel | None
    diagnostics: tuple[Diagnostic, ...]

    @property
    def ok(self) -> bool:
        return self.model is not None and not any(
            diagnostic.severity == "error" for diagnostic in self.diagnostics
        )


def compile_rule_ir(document: Mapping[str, Any]) -> CompileResult:
    """Validate references and compile a JSON-like Rule IR mapping.

    This compiler deliberately does not infer missing rules. It rejects malformed
    references and reports incomplete evidence as a diagnostic for later policy
    handling by the verifier.
    """

    diagnostics: list[Diagnostic] = []
    if not isinstance(document, Mapping):
        return CompileResult(
            model=None,
            diagnostics=(
                Diagnostic("IR_NOT_OBJECT", "Rule IR must be an object.", "$"),
            ),
        )

    _require_non_empty_string(document, "schema_version", "$", diagnostics)
    game = document.get("game")
    if not isinstance(game, Mapping):
        diagnostics.append(
            Diagnostic("MISSING_GAME", "game must be an object.", "$.game")
        )
        game = {}
    game_id = _require_non_empty_string(game, "game_id", "$.game", diagnostics)

    collections = {
        "sources": document.get("sources"),
        "evidence": document.get("evidence"),
        "entities": document.get("entities"),
        "quests": document.get("quests"),
        "stages": document.get("stages", []),
        "objectives": document.get("objectives", []),
        "world_variables": document.get("world_variables"),
        "actions": document.get("actions"),
        "transitions": document.get("transitions"),
        "alternative_paths": document.get("alternative_paths", []),
        "failure_branches": document.get("failure_branches", []),
        "recovery_paths": document.get("recovery_paths", []),
        "dependencies": document.get("dependencies", []),
        "properties": document.get("properties"),
    }
    parsed: dict[str, tuple[Mapping[str, Any], ...]] = {}
    for name, value in collections.items():
        parsed[name] = _read_collection(name, value, diagnostics)

    ids: dict[str, set[str]] = {}
    for collection_name, items in parsed.items():
        if collection_name == "sources":
            key = "source_id"
        elif collection_name == "evidence":
            key = "evidence_id"
        elif collection_name == "world_variables":
            key = "id"
        elif collection_name == "quests":
            key = "id"
        elif collection_name == "entities":
            key = "id"
        elif collection_name == "actions":
            key = "action_id"
        elif collection_name == "transitions":
            key = "transition_id"
        elif collection_name in {
            "stages",
            "objectives",
            "alternative_paths",
            "failure_branches",
            "recovery_paths",
            "dependencies",
        }:
            key = "id"
        else:
            key = "property_id"
        ids[collection_name] = _collect_ids(collection_name, items, key, diagnostics)

    _check_evidence_references(parsed, ids, diagnostics)
    _check_world_variable_references(parsed, ids, diagnostics)
    _check_action_references(parsed, ids, diagnostics)
    _check_transition_references(parsed, ids, diagnostics)
    _check_property_references(parsed, ids, diagnostics)
    _check_quest_stage_references(parsed, diagnostics)

    if any(diagnostic.severity == "error" for diagnostic in diagnostics):
        return CompileResult(model=None, diagnostics=tuple(diagnostics))

    model = QuestModel(
        schema_version=str(document["schema_version"]),
        game_id=game_id,
        quests=parsed["quests"],
        world_variables=parsed["world_variables"],
        actions=parsed["actions"],
        transitions=parsed["transitions"],
        properties=parsed["properties"],
    )
    return CompileResult(model=model, diagnostics=tuple(diagnostics))


def _read_collection(
    name: str, value: Any, diagnostics: list[Diagnostic]
) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list):
        diagnostics.append(
            Diagnostic("COLLECTION_NOT_ARRAY", f"{name} must be an array.", f"$.{name}")
        )
        return ()
    result: list[Mapping[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            diagnostics.append(
                Diagnostic(
                    "ITEM_NOT_OBJECT",
                    f"{name} items must be objects.",
                    f"$.{name}[{index}]",
                )
            )
            continue
        result.append(item)
    return tuple(result)


def _collect_ids(
    collection: str,
    items: tuple[Mapping[str, Any], ...],
    key: str,
    diagnostics: list[Diagnostic],
) -> set[str]:
    result: set[str] = set()
    for index, item in enumerate(items):
        path = f"$.{collection}[{index}].{key}"
        value = _require_non_empty_string(item, key, f"$.{collection}[{index}]", diagnostics)
        if value is None:
            continue
        if value in result:
            diagnostics.append(
                Diagnostic("DUPLICATE_ID", f"Duplicate ID: {value}.", path)
            )
        result.add(value)
    return result


def _require_non_empty_string(
    value: Mapping[str, Any], key: str, path: str, diagnostics: list[Diagnostic]
) -> str | None:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        diagnostics.append(
            Diagnostic("REQUIRED_STRING", f"{key} must be a non-empty string.", f"{path}.{key}")
        )
        return None
    return item


def _check_evidence_references(
    parsed: Mapping[str, tuple[Mapping[str, Any], ...]],
    ids: Mapping[str, set[str]],
    diagnostics: list[Diagnostic],
) -> None:
    source_ids = ids["sources"]
    evidence_ids = ids["evidence"]
    for index, evidence in enumerate(parsed["evidence"]):
        source_id = evidence.get("source_id")
        if source_id not in source_ids:
            diagnostics.append(
                Diagnostic(
                    "UNKNOWN_SOURCE",
                    f"Evidence references unknown source: {source_id}.",
                    f"$.evidence[{index}].source_id",
                )
            )
    for collection_name, items in parsed.items():
        for index, item in enumerate(items):
            refs = item.get("evidence", [])
            if not isinstance(refs, list):
                diagnostics.append(
                    Diagnostic(
                        "EVIDENCE_NOT_ARRAY",
                        "evidence must be an array.",
                        f"$.{collection_name}[{index}].evidence",
                    )
                )
                continue
            for ref_index, evidence_id in enumerate(refs):
                if evidence_id not in evidence_ids:
                    diagnostics.append(
                        Diagnostic(
                            "UNKNOWN_EVIDENCE",
                            f"Unknown evidence ID: {evidence_id}.",
                            f"$.{collection_name}[{index}].evidence[{ref_index}]",
                        )
                    )


def _check_world_variable_references(
    parsed: Mapping[str, tuple[Mapping[str, Any], ...]],
    ids: Mapping[str, set[str]],
    diagnostics: list[Diagnostic],
) -> None:
    variables = ids["world_variables"]
    for collection_name in ("actions", "transitions"):
        for index, item in enumerate(parsed[collection_name]):
            for field in ("preconditions", "guards", "effects"):
                values = item.get(field, [])
                if not isinstance(values, list):
                    continue
                for value_index, condition in enumerate(values):
                    if not isinstance(condition, Mapping):
                        continue
                    variable = condition.get("variable")
                    if variable not in variables:
                        diagnostics.append(
                            Diagnostic(
                                "UNKNOWN_VARIABLE",
                                f"Unknown world variable: {variable}.",
                                f"$.{collection_name}[{index}].{field}[{value_index}].variable",
                            )
                        )


def _check_action_references(
    parsed: Mapping[str, tuple[Mapping[str, Any], ...]],
    ids: Mapping[str, set[str]],
    diagnostics: list[Diagnostic],
) -> None:
    entities = ids["entities"]
    actions = ids["actions"]
    for index, action in enumerate(parsed["actions"]):
        for field in ("affected_entities",):
            values = action.get(field, [])
            if not isinstance(values, list):
                continue
            for value_index, entity_id in enumerate(values):
                if entity_id not in entities:
                    diagnostics.append(
                        Diagnostic(
                            "UNKNOWN_ENTITY",
                            f"Unknown entity: {entity_id}.",
                            f"$.actions[{index}].{field}[{value_index}]",
                        )
                    )
    for index, variable in enumerate(parsed["world_variables"]):
        for action_index, action_id in enumerate(variable.get("modified_by", [])):
            if action_id not in actions:
                diagnostics.append(
                    Diagnostic(
                        "UNKNOWN_ACTION",
                        f"Unknown action: {action_id}.",
                        f"$.world_variables[{index}].modified_by[{action_index}]",
                    )
                )


def _check_transition_references(
    parsed: Mapping[str, tuple[Mapping[str, Any], ...]],
    ids: Mapping[str, set[str]],
    diagnostics: list[Diagnostic],
) -> None:
    quests = ids["quests"]
    for index, transition in enumerate(parsed["transitions"]):
        quest_id = transition.get("quest_id")
        if quest_id is not None and quest_id not in quests:
            diagnostics.append(
                Diagnostic(
                    "UNKNOWN_QUEST",
                    f"Unknown quest: {quest_id}.",
                    f"$.transitions[{index}].quest_id",
                )
            )


def _check_property_references(
    parsed: Mapping[str, tuple[Mapping[str, Any], ...]],
    ids: Mapping[str, set[str]],
    diagnostics: list[Diagnostic],
) -> None:
    all_ids = set().union(*ids.values())
    for quest in parsed["quests"]:
        all_ids.update(quest.get("stage_ids", []))
        all_ids.update(quest.get("objective_ids", []))
    for collection_name in (
        "stages",
        "objectives",
        "alternative_paths",
        "failure_branches",
        "recovery_paths",
        "dependencies",
    ):
        for item in parsed.get(collection_name, ()):
            item_id = item.get("id")
            if isinstance(item_id, str):
                all_ids.add(item_id)
    for index, prop in enumerate(parsed["properties"]):
        target_id = prop.get("target_id")
        if target_id not in all_ids:
            diagnostics.append(
                Diagnostic(
                    "UNKNOWN_PROPERTY_TARGET",
                    f"Unknown property target: {target_id}.",
                    f"$.properties[{index}].target_id",
                )
            )


def _check_quest_stage_references(
    parsed: Mapping[str, tuple[Mapping[str, Any], ...]],
    diagnostics: list[Diagnostic],
) -> None:
    quest_ids = {quest.get("id") for quest in parsed["quests"]}
    stage_ids: set[str] = set()
    for index, quest in enumerate(parsed["quests"]):
        for stage_index, stage_id in enumerate(quest.get("stage_ids", [])):
            if stage_id in stage_ids:
                diagnostics.append(
                    Diagnostic(
                        "DUPLICATE_STAGE_ID",
                        f"Stage is referenced more than once: {stage_id}.",
                        f"$.quests[{index}].stage_ids[{stage_index}]",
                    )
                )
            stage_ids.add(stage_id)
    for index, transition in enumerate(parsed["transitions"]):
        quest_id = transition.get("quest_id")
        if quest_id is not None and quest_id not in quest_ids:
            continue
        target = transition.get("target_state")
        if not isinstance(target, str) or not target:
            diagnostics.append(
                Diagnostic(
                    "EMPTY_TRANSITION_STATE",
                    "Transition target_state must be a non-empty string.",
                    f"$.transitions[{index}].target_state",
                )
            )
