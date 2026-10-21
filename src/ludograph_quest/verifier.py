"""Bounded state-space verification for compiled quest models."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable

from .compiler import QuestModel


@dataclass(frozen=True)
class PathStep:
    step_id: str
    kind: str
    description: str
    evidence: tuple[str, ...]


@dataclass(frozen=True)
class VerificationReport:
    result: str
    issue_code: str | None
    message: str
    path: tuple[PathStep, ...] = ()
    assumptions: tuple[str, ...] = ()
    states_explored: int = 0
    depth_bound: int = 0
    state_bound: int = 0


@dataclass(frozen=True)
class _State:
    quest_states: tuple[tuple[str, str], ...]
    variables: tuple[tuple[str, Any], ...]


def verify_reachability(
    model: QuestModel,
    quest_id: str,
    target_state: str = "COMPLETED",
    *,
    depth_bound: int = 100,
    state_bound: int = 10_000,
) -> VerificationReport:
    """Find a path to a quest state using bounded breadth-first search."""

    if quest_id not in {quest["id"] for quest in model.quests}:
        return _not_modeled("UNKNOWN_QUEST", f"Unknown quest: {quest_id}.")
    initial = _initial_state(model)
    queue: deque[tuple[_State, tuple[PathStep, ...], int]] = deque(
        [(initial, (), 0)]
    )
    visited = {initial}
    explored = 0
    while queue:
        state, path, depth = queue.popleft()
        explored += 1
        if dict(state.quest_states).get(quest_id) == target_state:
            return VerificationReport(
                "proved",
                None,
                f"{quest_id} reaches {target_state}.",
                path,
                states_explored=explored,
                depth_bound=depth_bound,
                state_bound=state_bound,
            )
        if explored >= state_bound or depth >= depth_bound:
            continue
        for next_state, step in _successors(model, state):
            if next_state in visited:
                continue
            visited.add(next_state)
            queue.append((next_state, path + (step,), depth + 1))
    result = "unknown" if explored >= state_bound else "counterexample"
    code = "INCOMPLETE_RULE_MODEL" if result == "unknown" else "QUEST_OBJECTIVE_UNREACHABLE"
    return VerificationReport(
        result,
        code,
        f"{quest_id} cannot reach {target_state} in the compiled model.",
        states_explored=explored,
        depth_bound=depth_bound,
        state_bound=state_bound,
    )


def find_deadlocks(
    model: QuestModel,
    *,
    depth_bound: int = 100,
    state_bound: int = 10_000,
) -> tuple[VerificationReport, ...]:
    """Find active or blocked non-terminal states with no legal successor."""

    initial = _initial_state(model)
    terminals = {
        quest["id"]: set(quest.get("terminal_states", ())) for quest in model.quests
    }
    queue: deque[tuple[_State, tuple[PathStep, ...], int]] = deque(
        [(initial, (), 0)]
    )
    visited = {initial}
    reports: list[VerificationReport] = []
    explored = 0
    while queue and explored < state_bound:
        state, path, depth = queue.popleft()
        explored += 1
        successors = list(_successors(model, state))
        active_nonterminal = [
            quest_id
            for quest_id, quest_state in state.quest_states
            if quest_state in {"ACTIVE", "BLOCKED"}
            and quest_state not in terminals.get(quest_id, set())
        ]
        if active_nonterminal and not successors:
            reports.append(
                VerificationReport(
                    "counterexample",
                    "QUEST_DEADLOCK",
                    "Active or blocked quests have no legal successor.",
                    path,
                    states_explored=explored,
                    depth_bound=depth_bound,
                    state_bound=state_bound,
                )
            )
        if depth >= depth_bound:
            continue
        for next_state, step in successors:
            if next_state not in visited:
                visited.add(next_state)
                queue.append((next_state, path + (step,), depth + 1))
    return tuple(reports)


def find_cross_quest_interference(
    model: QuestModel, target_quest_id: str
) -> tuple[VerificationReport, ...]:
    """Report actions that make a target quest guard false without recovery."""

    target_transitions = [
        transition
        for transition in model.transitions
        if transition.get("quest_id") == target_quest_id
    ]
    reports: list[VerificationReport] = []
    for action in model.actions:
        for effect in action.get("effects", ()):
            variable = effect.get("variable")
            value = effect.get("value")
            for transition in target_transitions:
                for guard in transition.get("guards", ()):
                    if guard.get("variable") != variable or _condition_matches(
                        value, guard.get("operator"), guard.get("value")
                    ):
                        continue
                    if effect.get("reversibility") == "reversible":
                        continue
                    reports.append(
                        VerificationReport(
                            "counterexample",
                            "CROSS_QUEST_INTERFERENCE",
                            f"Action {action.get('action_id')} invalidates a guard of "
                            f"{target_quest_id}.",
                            (
                                PathStep(
                                    action.get("action_id", "unknown"),
                                    "action",
                                    f"{action.get('action_type', 'action')} changes "
                                    f"{variable} to {value!r}.",
                                    tuple(action.get("evidence", ())),
                                ),
                            ),
                            assumptions=(
                                "The affected guard is required by the target transition.",
                                "No supported recovery or alternative path is encoded.",
                            ),
                        )
                    )
    return tuple(reports)


def _initial_state(model: QuestModel) -> _State:
    return _State(
        tuple(sorted((quest["id"], quest["initial_state"]) for quest in model.quests)),
        tuple(sorted((variable["id"], variable["initial"]) for variable in model.world_variables)),
    )


def _successors(model: QuestModel, state: _State) -> Iterable[tuple[_State, PathStep]]:
    variables = dict(state.variables)
    quest_states = dict(state.quest_states)
    for action in model.actions:
        if not _conditions_hold(action.get("preconditions", ()), variables):
            continue
        next_variables = _apply_effects(variables, action.get("effects", ()))
        yield (
            _make_state(quest_states, next_variables),
            PathStep(
                action.get("action_id", "unknown"),
                "action",
                action.get("action_type", "action"),
                tuple(action.get("evidence", ())),
            ),
        )
    for transition in model.transitions:
        quest_id = transition.get("quest_id")
        if not quest_id or quest_states.get(quest_id) != transition.get("source_state"):
            continue
        if not _conditions_hold(transition.get("guards", ()), variables):
            continue
        next_variables = _apply_effects(variables, transition.get("effects", ()))
        next_quests = dict(quest_states)
        next_quests[quest_id] = transition["target_state"]
        yield (
            _make_state(next_quests, next_variables),
            PathStep(
                transition.get("transition_id", "unknown"),
                "transition",
                f"{transition.get('source_state')} -> {transition.get('target_state')}",
                tuple(transition.get("evidence", ())),
            ),
        )


def _make_state(quest_states: dict[str, str], variables: dict[str, Any]) -> _State:
    return _State(tuple(sorted(quest_states.items())), tuple(sorted(variables.items())))


def _apply_effects(
    variables: dict[str, Any], effects: Iterable[dict[str, Any]]
) -> dict[str, Any]:
    next_variables = dict(variables)
    for effect in effects:
        next_variables[effect["variable"]] = effect["value"]
    return next_variables


def _conditions_hold(
    conditions: Iterable[dict[str, Any]], variables: dict[str, Any]
) -> bool:
    return all(
        condition.get("variable") in variables
        and _condition_matches(
            variables[condition["variable"]],
            condition.get("operator"),
            condition.get("value"),
        )
        for condition in conditions
    )


def _condition_matches(actual: Any, operator: str | None, expected: Any) -> bool:
    if operator == "eq":
        return actual == expected
    if operator == "neq":
        return actual != expected
    if operator == "in":
        return actual in expected
    if operator == "not_in":
        return actual not in expected
    if operator == "gt":
        return actual > expected
    if operator == "gte":
        return actual >= expected
    if operator == "lt":
        return actual < expected
    if operator == "lte":
        return actual <= expected
    return False


def _not_modeled(code: str, message: str) -> VerificationReport:
    return VerificationReport("not-modeled", code, message)
