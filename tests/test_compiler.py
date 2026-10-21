import unittest

from ludograph_quest.compiler import compile_rule_ir


class CompilerTests(unittest.TestCase):
    def test_unknown_evidence_is_rejected(self) -> None:
        document = {
            "schema_version": "1.0.0",
            "game": {"game_id": "test"},
            "sources": [],
            "evidence": [],
            "entities": [],
            "quests": [],
            "world_variables": [],
            "actions": [],
            "transitions": [],
            "properties": [],
        }
        document["quests"].append(
            {
                "id": "quest-1",
                "display_name": "Test",
                "initial_state": "NOT_STARTED",
                "terminal_states": ["COMPLETED"],
                "stage_ids": [],
                "evidence": ["missing"],
            }
        )
        result = compile_rule_ir(document)
        self.assertFalse(result.ok)
        self.assertIn("UNKNOWN_EVIDENCE", {item.code for item in result.diagnostics})

    def test_unknown_variable_is_rejected(self) -> None:
        document = {
            "schema_version": "1.0.0",
            "game": {"game_id": "test"},
            "sources": [{"source_id": "source-1", "url": "https://example.test", "title": "Test", "accessed_at": "2026-10-20", "source_type": "test"}],
            "evidence": [{"evidence_id": "evidence-1", "source_id": "source-1", "summary": "Test", "certainty": "explicit", "evidence_assessment": "accepted"}],
            "entities": [],
            "quests": [],
            "world_variables": [{"id": "known", "type": "boolean", "initial": True, "values": [True, False], "reversibility": "reversible"}],
            "actions": [{
                "action_id": "action-1", "action_type": "test", "actor": "player",
                "preconditions": [{"variable": "missing", "operator": "eq", "value": True}],
                "effects": [], "irreversible": False, "affected_entities": [], "evidence": ["evidence-1"]
            }],
            "transitions": [],
            "properties": []
        }
        result = compile_rule_ir(document)
        self.assertFalse(result.ok)
        self.assertIn("UNKNOWN_VARIABLE", {item.code for item in result.diagnostics})


if __name__ == "__main__":
    unittest.main()
