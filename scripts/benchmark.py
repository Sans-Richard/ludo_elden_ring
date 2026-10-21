from pathlib import Path
import json
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

def main() -> None:
    root = Path(__file__).parents[1]
    document = json.loads((root / "input" / "knowledge-graph.json").read_text(encoding="utf-8"))
    start = perf_counter()
    graph = document["graph"]
    load_ms = (perf_counter() - start) * 1000
    print(json.dumps({
        "status": "measured",
        "load_ms": round(load_ms, 3),
        "graph_type": graph["graph_type"],
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
