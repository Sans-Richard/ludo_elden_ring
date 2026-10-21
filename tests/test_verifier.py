import unittest

from ludograph_quest.compiler import compile_rule_ir
from ludograph_quest.adapter import extraction_envelope_to_context
from ludograph_quest.reporting import report_to_dict
from ludograph_quest.verifier import (
    find_cross_quest_interference,
    find_deadlocks,
    verify_reachability,
)


def compile_fixture(document):
    result = compile_rule_ir(document)
    if not result.ok:
        raise AssertionError(result.diagnostics)
    return result.model


def base_document():
    return {
        "schema_version": "1.0.0",
        "game": {"game_id": "test"},
        "sources": [{"source_id": "s", "url": "https://example.test", "title": "T", "accessed_at": "2026-10-20", "source_type": "test"}],
        "evidence": [{"evidence_id": "e", "source_id": "s", "summary": "fixture", "certainty": "explicit", "evidence_assessment": "accepted"}],
        "entities": [{"id": "npc", "entity_type": "character", "display_name": "NPC", "evidence": ["e"]}],
        "quests": [],
        "world_variables": [],
        "actions": [],
        "transitions": [],
        "properties": [],
    }


class VerifierTests(unittest.TestCase):
    def test_reachability_returns_replayable_path(self):
        document = base_document()
        document["quests"] = [{"id": "q", "display_name": "Q", "initial_state": "AVAILABLE", "terminal_states": ["COMPLETED"], "stage_ids": [], "evidence": ["e"]}]
        document["transitions"] = [{"transition_id": "complete", "quest_id": "q", "source_state": "AVAILABLE", "target_state": "COMPLETED", "guards": [], "effects": [], "evidence": ["e"]}]
        report = verify_reachability(compile_fixture(document), "q")
        self.assertEqual(report.result, "proved")
        self.assertEqual(report.path[0].step_id, "complete")

    def test_unreachable_target_is_reported(self):
        document = base_document()
        document["quests"] = [{"id": "q", "display_name": "Q", "initial_state": "ACTIVE", "terminal_states": ["COMPLETED"], "stage_ids": [], "evidence": ["e"]}]
        report = verify_reachability(compile_fixture(document), "q")
        self.assertEqual(report.issue_code, "QUEST_OBJECTIVE_UNREACHABLE")

    def test_interference_requires_irreversible_effect(self):
        document = base_document()
        document["quests"] = [{"id": "q", "display_name": "Q", "initial_state": "AVAILABLE", "terminal_states": ["COMPLETED"], "stage_ids": [], "evidence": ["e"]}]
        document["world_variables"] = [{"id": "npc_alive", "type": "boolean", "initial": True, "values": [True, False], "reversibility": "irreversible", "modified_by": ["kill"], "evidence": ["e"]}]
        document["actions"] = [{"action_id": "kill", "action_type": "kill", "actor": "player", "preconditions": [], "effects": [{"variable": "npc_alive", "value": False, "reversibility": "irreversible", "evidence": ["e"]}], "irreversible": True, "affected_entities": ["npc"], "evidence": ["e"]}]
        document["transitions"] = [{"transition_id": "start", "quest_id": "q", "source_state": "AVAILABLE", "target_state": "ACTIVE", "guards": [{"variable": "npc_alive", "operator": "eq", "value": True}], "effects": [], "evidence": ["e"]}]
        reports = find_cross_quest_interference(compile_fixture(document), "q")
        self.assertEqual(reports[0].issue_code, "CROSS_QUEST_INTERFERENCE")

    def test_deadlock_is_detected(self):
        document = base_document()
        document["quests"] = [{"id": "q", "display_name": "Q", "initial_state": "ACTIVE", "terminal_states": ["COMPLETED"], "stage_ids": [], "evidence": ["e"]}]
        reports = find_deadlocks(compile_fixture(document))
        self.assertEqual(reports[0].issue_code, "QUEST_DEADLOCK")

    def test_report_is_json_compatible(self):
        document = base_document()
        document["quests"] = [{"id": "q", "display_name": "Q", "initial_state": "ACTIVE", "terminal_states": ["COMPLETED"], "stage_ids": [], "evidence": ["e"]}]
        report = find_deadlocks(compile_fixture(document))[0]
        self.assertEqual(report_to_dict(report)["result"], "counterexample")

    def test_ludograph_envelope_is_preserved(self):
        envelope = {
            "ontology_version": "2.0.0",
            "scope": {"game_id": "test", "system_id": "quest"},
            "status": "partial",
            "nodes": [{"id": "n1"}],
            "claims": [{"predicate": "requires"}],
            "uncovered": [{"text": "unknown"}],
        }
        context = extraction_envelope_to_context(envelope)
        self.assertEqual(context["claims"], envelope["claims"])
        self.assertEqual(context["uncovered"], envelope["uncovered"])


if __name__ == "__main__":
    unittest.main()
