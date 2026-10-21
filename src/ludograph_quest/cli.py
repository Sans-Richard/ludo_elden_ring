"""Command-line entry point for the quest verification MVP."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .compiler import compile_rule_ir
from .reporting import report_to_dict, reports_to_dict
from .verifier import find_cross_quest_interference, find_deadlocks, verify_reachability


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a LudoGraph Quest Rule IR document.")
    parser.add_argument("document", type=Path)
    parser.add_argument("--quest", help="Quest ID for reachability and interference checks.")
    parser.add_argument("--target-state", default="COMPLETED")
    parser.add_argument("--depth-bound", type=int, default=100)
    parser.add_argument("--state-bound", type=int, default=10_000)
    args = parser.parse_args()

    document = json.loads(args.document.read_text(encoding="utf-8"))
    compiled = compile_rule_ir(document)
    if not compiled.ok:
        print(json.dumps({"compile_diagnostics": [item.__dict__ for item in compiled.diagnostics]}, ensure_ascii=False, indent=2))
        return 2

    output = {
        "game_id": compiled.model.game_id,
        "deadlocks": reports_to_dict(
            find_deadlocks(compiled.model, depth_bound=args.depth_bound, state_bound=args.state_bound)
        ),
    }
    if args.quest:
        output["reachability"] = report_to_dict(
            verify_reachability(
                compiled.model,
                args.quest,
                args.target_state,
                depth_bound=args.depth_bound,
                state_bound=args.state_bound,
            )
        )
        output["interference"] = reports_to_dict(
            find_cross_quest_interference(compiled.model, args.quest)
        )
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
